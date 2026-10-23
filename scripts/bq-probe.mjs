// 데이터 확인용: node --env-file=.env.local scripts/bq-probe.mjs "<SQL>" [dry]
import { BigQuery } from '@google-cloud/bigquery';

const bq = new BigQuery({
  projectId: process.env.GOOGLE_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
});

process.on("unhandledRejection", (e) => { console.error("ERR", e.message); process.exit(1); });
const [, , sql, mode] = process.argv;
const opts = { query: sql, location: process.env.BQ_LOCATION ?? 'asia-northeast3', maximumBytesBilled: '3000000000' };
if (mode === 'dry') {
  const [job] = await bq.createQueryJob({ ...opts, dryRun: true });
  console.log('bytes', (Number(job.metadata.statistics.totalBytesProcessed) / 1e9).toFixed(3), 'GB');
} else {
  const [rows] = await bq.query(opts);
  console.table(rows.slice(0, 60));
  console.log('rows', rows.length);
}
