param(
    [Parameter(Mandatory=$true)][string]$Python,
    [Parameter(Mandatory=$true)][string]$Script,
    [Parameter(Mandatory=$true)][string]$Models
)
$ErrorActionPreference = 'Stop'
# Build-machine-only rule, scoped to the interpreter under test. Never shipped.
if (@(Get-NetFirewallProfile | Where-Object { $_.Enabled -ne 'True' }).Count -gt 0) {
    throw 'Offline model verification requires enabled Windows Firewall profiles.'
}
$ruleName = 'LazuliteStudio-ModelSmoke-' + [guid]::NewGuid().ToString()
try {
    New-NetFirewallRule -Name $ruleName -DisplayName $ruleName -Direction Outbound -Program $Python -Action Block -Profile Any | Out-Null
    & $Python -E -s -X utf8 $Script --models $Models --os-isolated
    if ($LASTEXITCODE -ne 0) { throw "Offline model verification failed: $LASTEXITCODE" }
}
finally {
    Remove-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
}
