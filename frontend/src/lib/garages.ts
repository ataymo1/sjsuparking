export const GARAGES = [
  "South Garage",
  "North Garage",
  "West Garage",
  "South Campus Garage",
] as const

export type GarageName = (typeof GARAGES)[number]

export type GarageStatusRow = {
  fetched_at: string
  last_updated: string | null
  garage: string
  status: number
  source_url: string
}

