# Registers the Windows Task Scheduler job 'ManiacNaverPublish':
# every day from 05:10, every 30 minutes for 6 hours, run run_daily.cmd (one post per run, up to 3 a day).
# -WakeToRun wakes the PC from sleep (needs "Allow wake timers" in power options),
# -StartWhenAvailable runs a missed start as soon as the PC is on.
# Usage (PowerShell, in this folder):  powershell -ExecutionPolicy Bypass -File .\setup_task.ps1
$cmd = Join-Path $PSScriptRoot 'run_daily.cmd'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$cmd`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Daily -At '05:10'
$repeat = New-ScheduledTaskTrigger -Once -At '05:10' -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Hours 6)
$trigger.Repetition = $repeat.Repetition
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 25) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'ManiacNaverPublish' -Action $action -Trigger $trigger -Settings $settings -Description 'Maniac blog: publish Claude daily post to Naver' -Force | Out-Null
Write-Host 'OK: ManiacNaverPublish registered (daily 05:10-11:10, every 30 min)'
