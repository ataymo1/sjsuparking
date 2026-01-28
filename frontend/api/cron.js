import https from "node:https"

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function parseLastUpdated(text) {
  const m = text.match(/\bLast updated\b\s+(.+?)(?:\s+Refresh\b|$)/i)
  return m?.[1]?.trim() ?? null
}

function parseStatuses(text) {
  const garageNames = ["South Garage", "North Garage", "West Garage", "South Campus Garage"]

  const positions = garageNames
    .map((name) => ({ name, idx: text.toLowerCase().indexOf(name.toLowerCase()) }))
    .filter((x) => x.idx !== -1)
    .sort((a, b) => a.idx - b.idx)

  /** @type {Record<string, number>} */
  const statuses = {}

  for (let i = 0; i < positions.length; i++) {
    const { name, idx } = positions[i]
    const nextIdx = positions[i + 1]?.idx ?? text.length
    const segment = text.slice(idx, nextIdx)

    const pattern = new RegExp(
      `${escapeRegExp(name)}.*?(?:\\d+\\s+[SNWE].*?)?\\s+(Full|\\d+\\s*%)`,
      "i",
    )
    const match = segment.match(pattern)
    if (!match) continue

    const statusText = match[1].trim()
    if (statusText.toLowerCase() === "full") {
      statuses[name] = 100
      continue
    }

    const numberStr = statusText.replace("%", "").trim()
    const n = Number.parseInt(numberStr, 10)
    if (Number.isFinite(n)) statuses[name] = n
  }

  return statuses
}

async function fetchWithTimeout(
  url,
  init = {},
  { timeoutMs = 10_000, fetchFn = fetch } = {},
) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetchFn(url, { ...init, signal: controller.signal })
    return resp
  } finally {
    clearTimeout(t)
  }
}

async function fetchGarageStatusPage(url) {
  try {
    return await fetchWithTimeout(url, {}, { timeoutMs: 10_000 })
  } catch (e) {
    const code = e?.cause?.code
    const tlsCodes = new Set([
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
    ])
    if (!tlsCodes.has(code)) throw e

    // Fallback for environments where Node can't validate the site's TLS chain.
    return await new Promise((resolve, reject) => {
      const req = https.get(url, { rejectUnauthorized: false }, (resp) => {
        let data = ""
        resp.setEncoding("utf8")
        resp.on("data", (chunk) => {
          data += chunk
        })
        resp.on("end", () => {
          const status = resp.statusCode ?? 0
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: async () => data,
          })
        })
      })
      req.on("error", reject)
      req.setTimeout(10_000, () => req.destroy(new Error("Timeout fetching garage status page")))
    })
  }
}

function getRequestToken(req) {
  const token = req.query?.token
  return Array.isArray(token) ? token[0] : token
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD")
    return res.status(405).json({ error: "Method not allowed" })
  }

  // Vercel Cron Jobs automatically send: Authorization: Bearer ${CRON_SECRET}
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res.status(500).json({ error: "CRON_SECRET is not set in the environment" })
  }

  const auth = req.headers.authorization || ""
  const token = getRequestToken(req)
  const authed = auth === `Bearer ${cronSecret}` || token === cronSecret
  if (!authed) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_KEY
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "SUPABASE_URL or SUPABASE_KEY is not set" })
  }

  const sourceUrl = "https://sjsuparkingstatus.sjsu.edu/GarageStatusPlain"

  try {
    const pageResp = await fetchGarageStatusPage(sourceUrl)
    if (!pageResp.ok) {
      const body = await pageResp.text().catch(() => "")
      return res.status(502).json({
        error: "Failed to fetch garage status page",
        status: pageResp.status,
        body: body.slice(0, 500),
      })
    }

    const html = await pageResp.text()
    const text = htmlToText(html)

    const lastUpdated = parseLastUpdated(text)
    const statuses = parseStatuses(text)
    const fetchedAt = new Date().toISOString()

    const rows = Object.entries(statuses).map(([garage, status]) => ({
      fetched_at: fetchedAt,
      last_updated: lastUpdated,
      garage,
      status,
      source_url: sourceUrl,
    }))

    if (rows.length === 0) {
      return res.status(200).json({
        ok: true,
        inserted: 0,
        fetchedAt,
        lastUpdated,
        statuses,
        note: "No statuses parsed; nothing inserted",
      })
    }

    const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/garage_status`
    let resp
    try {
      resp = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify(rows),
        },
        { timeoutMs: 10_000 },
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const causeCode = e?.cause?.code
      return res.status(502).json({
        error: "Supabase insert failed",
        message,
        causeCode,
        fetchedAt,
        lastUpdated,
        statuses,
      })
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => "")
      return res.status(502).json({
        error: "Supabase insert failed",
        status: resp.status,
        body: body.slice(0, 2000),
        fetchedAt,
        lastUpdated,
        statuses,
      })
    }

    return res.status(200).json({
      ok: true,
      inserted: rows.length,
      fetchedAt,
      lastUpdated,
      statuses,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const causeCode = e?.cause?.code
    return res.status(500).json({ error: "Cron failed", message, causeCode })
  }
}