import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { type GarageStatusRow } from "@/lib/garages"

function formatDateTime(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d)
}

export function HistoryTable(props: { rows: GarageStatusRow[] }) {
  const rows = props.rows.slice(0, 25)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fetched</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden md:table-cell">Last updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={3} className="text-muted-foreground">
              No rows yet.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((r) => (
            <TableRow key={`${r.garage}-${r.fetched_at}-${r.status}`}>
              <TableCell className="font-mono text-xs">{formatDateTime(r.fetched_at)}</TableCell>
              <TableCell>
                <Badge variant={r.status === 100 ? "destructive" : "secondary"}>
                  {r.status === 100 ? "Full" : `${r.status}%`}
                </Badge>
              </TableCell>
              <TableCell className="hidden md:table-cell text-muted-foreground">
                {r.last_updated ?? "—"}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

