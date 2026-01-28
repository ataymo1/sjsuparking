import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { type GarageStatusRow } from "@/lib/garages"

function formatDateTime(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d)
}

export function GarageCard(props: { garage: string; row: GarageStatusRow | null }) {
  const { garage, row } = props

  const status = row?.status ?? null
  const isFull = status === 100
  const statusLabel = status === null ? "—" : isFull ? "Full" : `${status}%`

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-lg">{garage}</CardTitle>
            <CardDescription className="truncate">
              {row?.fetched_at ? `Fetched ${formatDateTime(row.fetched_at)}` : "No data yet"}
            </CardDescription>
          </div>
          {status === null ? (
            <Skeleton className="h-5 w-14 rounded-full" />
          ) : (
            <Badge variant={isFull ? "destructive" : "secondary"}>{statusLabel}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {status === null ? (
          <Skeleton className="h-2 w-full" />
        ) : (
          <Progress value={status} aria-label={`${garage} occupancy`} />
        )}
        <div className="text-sm text-muted-foreground">
          {row?.last_updated ? `Source says: ${row.last_updated}` : " "}
        </div>
      </CardContent>
    </Card>
  )
}

