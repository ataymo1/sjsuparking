import { useCallback, useEffect, useMemo, useState } from "react"

import { type GarageStatusRow } from "@/lib/garages"
import { supabase, supabaseEnvError } from "@/lib/supabaseClient"

type GarageStatusState = {
  rows: GarageStatusRow[]
  isLoading: boolean
  error: string | null
  refreshedAt: Date | null
}

const DEFAULT_LIMIT = 500
const TABLE_NAME = "garage_status"

export function useGarageStatus(options?: { refreshIntervalMs?: number }) {
  const refreshIntervalMs = options?.refreshIntervalMs ?? 60_000

  const [state, setState] = useState<GarageStatusState>({
    rows: [],
    isLoading: true,
    error: null,
    refreshedAt: null,
  })

  const fetchRows = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }))

    if (supabaseEnvError || !supabase) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: supabaseEnvError ?? "Supabase client not initialized",
      }))
      return
    }

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select("fetched_at,last_updated,garage,status,source_url")
      .order("fetched_at", { ascending: false })
      .limit(DEFAULT_LIMIT)

    if (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error.message,
      }))
      return
    }

    setState({
      rows: (data ?? []) as GarageStatusRow[],
      isLoading: false,
      error: null,
      refreshedAt: new Date(),
    })
  }, [])

  useEffect(() => {
    void fetchRows()
  }, [fetchRows])

  useEffect(() => {
    if (!refreshIntervalMs) return
    const id = window.setInterval(() => void fetchRows(), refreshIntervalMs)
    return () => window.clearInterval(id)
  }, [fetchRows, refreshIntervalMs])

  const latestByGarage = useMemo(() => {
    const map = new Map<string, GarageStatusRow>()
    for (const row of state.rows) {
      if (!map.has(row.garage)) map.set(row.garage, row)
    }
    return map
  }, [state.rows])

  const historyByGarage = useMemo(() => {
    const map = new Map<string, GarageStatusRow[]>()
    for (const row of state.rows) {
      const arr = map.get(row.garage)
      if (arr) arr.push(row)
      else map.set(row.garage, [row])
    }
    return map
  }, [state.rows])

  const latestFetchedAt = useMemo(() => {
    const top = state.rows[0]?.fetched_at
    return top ? new Date(top) : null
  }, [state.rows])

  return {
    ...state,
    latestByGarage,
    historyByGarage,
    latestFetchedAt,
    refetch: fetchRows,
  }
}

