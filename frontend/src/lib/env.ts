export function getRequiredEnv(name: string): string {
  const value = import.meta.env[name] as string | undefined
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

