import { RefreshCw } from "lucide-react"

import { GarageCard } from "@/components/GarageCard"
import { HistoryTable } from "@/components/HistoryTable"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GARAGES } from "@/lib/garages"
import { useGarageStatus } from "@/hooks/useGarageStatus"

function formatTime(d: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d)
}

function tabValue(garage: string) {
  return garage.toLowerCase().replaceAll(" ", "-")
}

export function Dashboard() {
  const { isLoading, error, refreshedAt, latestFetchedAt, latestByGarage, historyByGarage, refetch } =
    useGarageStatus({ refreshIntervalMs: 60_000 })

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">SJSU Parking</h1>
            <p className="text-sm text-muted-foreground">
              {latestFetchedAt ? (
                <>
                  Latest reading at <span className="font-medium">{formatTime(latestFetchedAt)}</span>
                </>
              ) : (
                "No readings yet."
              )}
              {refreshedAt ? (
                <>
                  {" "}
                  (refreshed <span className="font-medium">{formatTime(refreshedAt)}</span>)
                </>
              ) : null}
            </p>
          </div>

          <Button
            variant="outline"
            onClick={() => void refetch()}
            disabled={isLoading}
            className="w-full sm:w-auto"
          >
            <RefreshCw className={isLoading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Failed to load garage status</AlertTitle>
            <AlertDescription>
              {error}
              <div className="mt-2 text-xs text-muted-foreground">
                Make sure your Supabase table/view is readable by anon and your `VITE_SUPABASE_*` env vars are set.
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {GARAGES.map((garage) => (
            <GarageCard key={garage} garage={garage} row={latestByGarage.get(garage) ?? null} />
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">History</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue={tabValue(GARAGES[0])}>
              <TabsList className="flex w-full flex-wrap justify-start gap-1">
                {GARAGES.map((garage) => (
                  <TabsTrigger key={garage} value={tabValue(garage)}>
                    {garage}
                  </TabsTrigger>
                ))}
              </TabsList>

              {GARAGES.map((garage) => (
                <TabsContent key={garage} value={tabValue(garage)}>
                  <HistoryTable rows={historyByGarage.get(garage) ?? []} />
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

