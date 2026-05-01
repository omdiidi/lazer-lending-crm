import { useAlerts } from '@/hooks/use-alerts'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, X } from 'lucide-react'

export function AlertBanner() {
  const { alerts, dismissAlert } = useAlerts()

  if (alerts.length === 0) return null

  const alert = alerts[0]
  const isWarning = alert.type === 'warning'

  return (
    <div className={`border-b px-4 py-2 ${isWarning ? 'bg-amber-50 border-amber-200' : 'bg-destructive/10 border-destructive/20'}`}>
      <div className="flex items-center gap-2 max-w-[1400px] mx-auto">
        <AlertTriangle className={`h-4 w-4 flex-shrink-0 ${isWarning ? 'text-amber-600' : 'text-destructive'}`} />
        <span className={`text-sm flex-1 ${isWarning ? 'text-amber-800' : 'text-destructive'}`}>
          <span className="font-medium">[{alert.source.toUpperCase()}]</span> {alert.message}
          {alerts.length > 1 && (
            <Badge variant="secondary" className="ml-2 text-[10px]">+{alerts.length - 1} more</Badge>
          )}
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => dismissAlert(alert.id)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
