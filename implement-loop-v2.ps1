param(
    [string]$Model = "sonnet",
    [string]$Label = "ready-for-agent",
    [ValidateSet("default", "acceptEdits", "auto", "dontAsk", "bypassPermissions", "manual")]
    [string]$PermissionMode = "auto",
    [int]$MaxIssues = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-Command {
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

    $args = @(
        "issue", "list",
        "--repo", $Repo,
        "--state", "open",
        "--limit", "200",
        "--json", "number,title,url,blockedBy"
    )

    if (-not [string]::IsNullOrWhiteSpace($TicketLabel)) {
        $args += @("--label", $TicketLabel)
    }

    $json = & gh @args

    if ($LASTEXITCODE -ne 0) {
        throw "Nem sikerült lekérni a GitHub issue-kat."
    }

    if ([string]::IsNullOrWhiteSpace(($json | Out-String))) {
        return @()
    }

    return @($json | ConvertFrom-Json)
}

function Test-IssueReady {
    param($Issue)

    $blockers = @($Issue.blockedBy)

    foreach ($blocker in $blockers) {
        if ($null -eq $blocker) {
            continue
        }

        # GitHub CLI verziótól függően a blockedBy elem
        # nem feltétlenül tartalmaz state mezőt.
        # Ezért a blocker aktuális állapotát külön kérjük le.
        $blockerUrl = $null

        if ($blocker.PSObject.Properties.Name -contains "url") {
            $blockerUrl = $blocker.url
        }

        if ([string]::IsNullOrWhiteSpace($blockerUrl)) {
            throw "Egy blockerhez nem kaptunk URL-t, ezért nem dönthető el biztonságosan, hogy az issue feloldott-e."
        }

        $blockerState = & gh issue view $blockerUrl `
            --json state `
            --jq ".state"

        if ($LASTEXITCODE -ne 0) {
            throw "Nem sikerült lekérni a blocker állapotát: $blockerUrl"
        }

        $blockerState = ($blockerState | Out-String).Trim().ToUpperInvariant()

        if ($blockerState -eq "OPEN") {
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

    $state = & gh issue view $IssueNumber `
        --repo $Repo `
        --json state `
        --jq ".state"

    if ($LASTEXITCODE -ne 0) {
        throw "Nem sikerült ellenőrizni a #$IssueNumber issue állapotát."
    }

    if (($state | Out-String).Trim().ToUpperInvariant() -eq "OPEN") {
        & gh issue close $IssueNumber `
            --repo $Repo `
            --reason completed `
            --comment "Implemented in commit $CommitHash"

        if ($LASTEXITCODE -ne 0) {
            throw "Az implementáció elkészült, de a #$IssueNumber issue lezárása sikertelen."
        }
    }
}

# ----- Előfeltételek -----

Require-Command "git"
Require-Command "gh"
Require-Command "claude"

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

    $readyTickets = @(
        $openTickets |
            Where-Object { Test-IssueReady $_ } |
            Sort-Object number
    )

    if ($readyTickets.Count -eq 0) {
        Write-Host ""
        Write-Host "Maradtak nyitott ticketek, de mindegyiket nyitott blocker blokkolja." -ForegroundColor Yellow
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

    if ($exitCode -ne 0) {
        Write-Host ""
        Write-Host "Claude hibával állt le a #$($issue.number) ticketen." -ForegroundColor Red
        Write-Host "A runner nem folytatja a következő tickettel."
        exit $exitCode
    }

    # Az implement skillnek commitolnia kell.
    Assert-CleanWorkingTree

    $afterCommit = (& git rev-parse HEAD | Out-String).Trim()

    if ($beforeCommit -eq $afterCommit) {
        Write-Host ""
        Write-Host "Nem keletkezett új commit a #$($issue.number) tickethez." -ForegroundColor Red
        Write-Host "Biztonsági okból az issue nem lesz lezárva, és a runner megáll."
        exit 1
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
