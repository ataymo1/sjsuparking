import { useMemo } from "react"
import {
  Area,
  AreaChart as RechartsAreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { type GarageStatusRow } from "@/lib/garages"
import { GARAGES } from "@/lib/garages"

type DailyData = {
  date: string
  [garage: string]: string | number
}

const COLORS = [
  "#8884d8",
  "#82ca9d",
  "#ffc658",
  "#ff7300",
]

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date)
}

function getDayKey(date: Date): string {
  const year = date.getFullYear()
  const month = date.getMonth()
  const day = date.getDate()
  return `${year}-${month}-${day}`
}

export function AreaChart(props: { rows: GarageStatusRow[] }) {
  const dailyData = useMemo(() => {
    if (!props.rows || props.rows.length === 0) {
      return []
    }

    // Group data by day and garage
    const dayMap = new Map<string, Map<string, number[]>>()

    for (const row of props.rows) {
      if (!row.fetched_at) continue
      
      const date = new Date(row.fetched_at)
      if (Number.isNaN(date.getTime())) continue

      const dayKey = getDayKey(date)
      if (!dayMap.has(dayKey)) {
        dayMap.set(dayKey, new Map())
      }

      const garageMap = dayMap.get(dayKey)!
      if (!garageMap.has(row.garage)) {
        garageMap.set(row.garage, [])
      }

      garageMap.get(row.garage)!.push(row.status)
    }

    if (dayMap.size === 0) {
      return []
    }

    // Calculate average status per day per garage
    // Sort days properly by converting to dates
    const sortedDays = Array.from(dayMap.keys()).sort((a, b) => {
      const [yearA, monthA, dayA] = a.split("-").map(Number)
      const [yearB, monthB, dayB] = b.split("-").map(Number)
      const dateA = new Date(yearA, monthA, dayA)
      const dateB = new Date(yearB, monthB, dayB)
      return dateA.getTime() - dateB.getTime()
    })

    const result: DailyData[] = []

    for (const dayKey of sortedDays) {
      const garageMap = dayMap.get(dayKey)!
      const [year, month, day] = dayKey.split("-").map(Number)
      const date = new Date(year, month, day)
      
      const dataPoint: DailyData = {
        date: formatDate(date),
      }

      for (const garage of GARAGES) {
        const statuses = garageMap.get(garage) ?? []
        dataPoint[garage] = statuses.length > 0
          ? Math.round(statuses.reduce((a, b) => a + b, 0) / statuses.length)
          : 0
      }

      result.push(dataPoint)
    }

    return result
  }, [props.rows])

  if (dailyData.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <div>No data available for chart</div>
        <div className="text-xs">
          {props.rows.length === 0 ? "No rows loaded yet" : `${props.rows.length} rows loaded, but no valid dates found`}
        </div>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={400}>
      <RechartsAreaChart data={dailyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <defs>
          {GARAGES.map((garage, index) => (
            <linearGradient key={garage} id={`color${garage}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS[index % COLORS.length]} stopOpacity={0.8} />
              <stop offset="95%" stopColor={COLORS[index % COLORS.length]} stopOpacity={0.1} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12 }}
          angle={-45}
          textAnchor="end"
          height={80}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 12 }}
          label={{ value: "Status %", angle: -90, position: "insideLeft" }}
        />
        <Tooltip
          formatter={(value: number | undefined) => value !== undefined ? [`${value}%`, ""] : ""}
          labelFormatter={(label) => `Date: ${label}`}
        />
        <Legend />
        {GARAGES.map((garage, index) => (
          <Area
            key={garage}
            type="monotone"
            dataKey={garage}
            stroke={COLORS[index % COLORS.length]}
            fill={`url(#color${garage})`}
            strokeWidth={2}
          />
        ))}
      </RechartsAreaChart>
    </ResponsiveContainer>
  )
}
