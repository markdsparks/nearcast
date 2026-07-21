# Trust Loop Analytics Readout

Run the manual **Report Trust Loop analytics** GitHub workflow to get a concise
event-volume funnel plus platform and app-version splits. The report is printed
in the job log and written to the GitHub step summary.

Repository setup requires:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_ANALYTICS_API_TOKEN`, created as a least-privilege custom token
  with **Account > Account Analytics > Read**

The workflow defaults to the `nearcast_product_events` dataset and seven days;
both inputs are validated, and the reporting window is limited to 1–90 days to
fit Analytics Engine's three-month retention. Run the same report locally with:

```sh
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_ANALYTICS_API_TOKEN=… \
  node scripts/trust-loop-report.mjs --days 7
```

This is anonymous aggregate event volume, not a unique-user or cohort funnel.
Cloudflare can sample on write or read, so the SQL correctly totals
`_sample_interval * double1`; `double1` is Nearcast's batched event count.
Nothing in the readout contains plan text, place data, device identifiers, or
the API token.

References: [Cloudflare Analytics Engine SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/),
[SQL JSON response format](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/statements/#format-clause),
and [Analytics Engine limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/).
