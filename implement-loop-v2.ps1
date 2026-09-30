param(
    [string]$Model = "claude-opus-5-5",
    [string]$Label = "ready-for-agent",
    [ValidateSet("default", "acceptEdits", "auto", "dontAsk", "bypassPermissions", "manual")]
    [string]$PermissionMode = "auto",
    [int]$MaxIssues = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-CommandAvailable {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "A '$Name' parancs nem található a PATH-ban."
    }
}

function Assert-CleanWorkingTree {
    $status = & git status --porcelain

    if ($LASTEXITCODE -ne 0) {
        throw "Nem sikerült lekérni a git státuszt."
    }

    if ($status) {
        throw @"
A working tree nem tiszta.
Commitold, stash-eld vagy töröld a változásokat, majd futtasd újra.

git status
"@
    }
}

function Get-CurrentRepo {
    $repo = & gh repo view --json nameWithOwner --jq ".nameWithOwner"

    if ($LASTEXITCODE -ne 0) {
        throw "Nem sikerült meghatározni az aktuális GitHub repository-t."
    }

    return ($repo | Out-String).Trim()
}

function Get-OpenAgentTickets {
    param(
        [string]$Repo,
        [string]$TicketLabel
    )

    $ghArgs = @(
        "issue", "list",
        "--repo", $Repo,
        "--state", "open",
        "--limit", "200",
        "--json", "number,title,url,blockedBy"
    )

    if (-not [string]::IsNullOrWhiteSpace($TicketLabel)) {
        $ghArgs += @("--label", $TicketLabel)
    }

    $json = & gh @ghArgs

    if ($LASTEXITCODE -ne 0) {
        throw "Nem sikerült lekérni a GitHub issue-kat."
    }

    if ([string]::IsNullOrWhiteSpace(($json | Out-String))) {
        return @()
    }

    return @($json | ConvertFrom-Json)
}

function Get-BlockerObjects {
    param($BlockedBy)

    if ($null -eq $BlockedBy) {
        return @()
    }

    # Current gh shape:
    # blockedBy = { nodes: [...], totalCount: N }
    if ($BlockedBy.PSObject.Properties.Name -contains "nodes") {
        $nodes = @($BlockedBy.nodes)

        if ($BlockedBy.PSObject.Properties.Name -contains "totalCount") {
            $totalCount = [int]$BlockedBy.totalCount

            # GitHub CLI caps blockedBy nodes. Fail safely if anything is truncated.
            if ($totalCount -gt $nodes.Count) {
                throw "A blockedBy lista csonkolva érkezett ($($nodes.Count)/$totalCount). Biztonsági okból a runner nem folytatja."
            }
        }

        return $nodes
    }

    # Compatibility with gh versions that may return a flat array.
    return @($BlockedBy)
}

function Get-BlockerState {
    param(
        [string]$Repo,
        $Blocker
    )

    if ($null -eq $Blocker) {
        return $null
    }

    # Preferred: state is already included in blockedBy.nodes.
    if ($Blocker.PSObject.Properties.Name -contains "state") {
        $state = [string]$Blocker.state
        if (-not [string]::IsNullOrWhiteSpace($state)) {
            return $state.ToUpperInvariant()
        }
    }

    # Fallback: query the blocker directly without any jq expression.
    if ($Blocker.PSObject.Properties.Name -contains "url") {
        $url = [string]$Blocker.url

        if (-not [string]::IsNullOrWhiteSpace($url)) {
            $raw = & gh issue view $url --json state

            if ($LASTEXITCODE -ne 0) {
                throw "Nem sikerült lekérni a blocker állapotát: $url"
            }

            $obj = $raw | ConvertFrom-Json
            return ([string]$obj.state).ToUpperInvariant()
        }
    }

    if ($Blocker.PSObject.Properties.Name -contains "number") {
        $number = [int]$Blocker.number

        $raw = & gh issue view $number --repo $Repo --json state

        if ($LASTEXITCODE -ne 0) {
            throw "Nem sikerült lekérni a blocker állapotát: #$number"
        }

        $obj = $raw | ConvertFrom-Json
        return ([string]$obj.state).ToUpperInvariant()
    }

    throw "Egy blocker objektumban sem state, sem url, sem number nem található."
}

function Test-IssueReady {
    param(
        [string]$Repo,
        $Issue
    )

    $blockers = @(Get-BlockerObjects -BlockedBy $Issue.blockedBy)

    foreach ($blocker in $blockers) {
        $state = Get-BlockerState -Repo $Repo -Blocker $blocker

        if ($state -eq "OPEN") {
            $blockerText = "ismeretlen blocker"

            if ($blocker.PSObject.Properties.Name -contains "number") {
                $blockerText = "#$($blocker.number)"
            }

            Write-Host "Skip #$($Issue.number): blokkolja $blockerText." -ForegroundColor DarkYellow
            return $false
        }
    }

    return $true
}

function Invoke-Implementation {
    param(
        [string]$IssueUrl,
        [string]$ClaudeModel,
        [string]$Mode
    )

    $prompt = "/implement $IssueUrl"

    Write-Host ""
    Write-Host "Claude indul: $prompt" -ForegroundColor Cyan

    & claude `
        -p `
        --model $ClaudeModel `
        --permission-mode $Mode `
        --no-session-persistence `
        $prompt

    return $LASTEXITCODE
}

function Close-CompletedIssue {
    param(
        [string]$Repo,
        [int]$IssueNumber,
        [string]$CommitHash
    )

    $raw = & gh issue view $IssueNumber `
        --repo $Repo `
        --json state

    if ($LASTEXITCODE -ne 0) {
        throw "Nem sikerült ellenőrizni a #$IssueNumber issue állapotát."
    }

    $issueState = $raw | ConvertFrom-Json

    if (([string]$issueState.state).ToUpperInvariant() -eq "OPEN") {
        & gh issue close $IssueNumber `
            --repo $Repo `
            --reason completed `
            --comment "Implemented in commit $CommitHash"

        if ($LASTEXITCODE -ne 0) {
            throw "Az implementáció elkészült, de a #$IssueNumber issue lezárása sikertelen."
        }
    }
}

# ----- Preconditions -----

Assert-CommandAvailable "git"
Assert-CommandAvailable "gh"
Assert-CommandAvailable "claude"

$repo = Get-CurrentRepo
$processed = 0

Write-Host ""
Write-Host "Repository:      $repo" -ForegroundColor Green
Write-Host "Ticket label:    $Label"
Write-Host "Claude model:    $Model"
Write-Host "Permission mode: $PermissionMode"

# ----- Implement loop -----

while ($true) {

    if ($MaxIssues -gt 0 -and $processed -ge $MaxIssues) {
        Write-Host ""
        Write-Host "Elértem a MaxIssues limitet: $MaxIssues" -ForegroundColor Yellow
        break
    }

    Assert-CleanWorkingTree

    $openTickets = @(Get-OpenAgentTickets -Repo $repo -TicketLabel $Label)

    if ($openTickets.Count -eq 0) {
        Write-Host ""
        Write-Host "Nincs több nyitott '$Label' ticket." -ForegroundColor Green
        break
    }

    $readyTickets = @()

    foreach ($candidate in ($openTickets | Sort-Object number)) {
        if (Test-IssueReady -Repo $repo -Issue $candidate) {
            $readyTickets += $candidate
        }
    }

    if ($readyTickets.Count -eq 0) {
        Write-Host ""
        Write-Host "Maradtak nyitott '$Label' ticketek, de mindegyiket nyitott blocker blokkolja." -ForegroundColor Yellow
        Write-Host "A runner leáll; ellenőrizd a GitHub dependency-ket."
        break
    }

    $issue = $readyTickets[0]

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor DarkGray
    Write-Host "#$($issue.number)  $($issue.title)" -ForegroundColor White
    Write-Host "$($issue.url)" -ForegroundColor DarkGray
    Write-Host "============================================================" -ForegroundColor DarkGray

    $beforeCommit = (& git rev-parse HEAD | Out-String).Trim()

    $exitCode = Invoke-Implementation `
        -IssueUrl $issue.url `
        -ClaudeModel $Model `
        -Mode $PermissionMode

    Assert-CleanWorkingTree

    $afterCommit = (& git rev-parse HEAD | Out-String).Trim()

    if ($beforeCommit -eq $afterCommit) {
        Write-Host ""
        Write-Host "Nem keletkezett új commit a #$($issue.number) tickethez." -ForegroundColor Red
        if ($exitCode -ne 0) {
            Write-Host "Claude hibakóddal is leállt ($exitCode)." -ForegroundColor Red
        }
        Write-Host "Biztonsági okból az issue nem lesz lezárva, és a runner megáll."
        exit 1
    }

    if ($exitCode -ne 0) {
        Write-Host ""
        Write-Host "Claude hibakóddal állt le ($exitCode) a #$($issue.number) ticketen, de új commit készült." -ForegroundColor Yellow
        Write-Host "A runner úgy tekinti, hogy a munka elkészült, és folytatja." -ForegroundColor Yellow
    }

    & git push

    if ($LASTEXITCODE -ne 0) {
        throw "Az implementáció elkészült, de a #$($issue.number) tickethez tartozó commit pusholása sikertelen."
    }

    $shortHash = (& git rev-parse --short HEAD | Out-String).Trim()

    Close-CompletedIssue `
        -Repo $repo `
        -IssueNumber $issue.number `
        -CommitHash $shortHash

    $processed++

    Write-Host ""
    Write-Host "Kész: #$($issue.number) -> $shortHash" -ForegroundColor Green
    Write-Host "Friss Claude contexttel jön a következő ticket." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Runner befejezve. Feldolgozott ticketek: $processed" -ForegroundColor Green
