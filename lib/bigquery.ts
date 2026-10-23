import 'server-only';
import { BigQuery } from '@google-cloud/bigquery';

let client: BigQuery | null = null;

function bq(): BigQuery {
  if (client) return client;
  if (!process.env.GOOGLE_PROJECT_ID || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('BigQuery 자격증명(GOOGLE_PROJECT_ID / GOOGLE_PRIVATE_KEY)이 없습니다.');
  }
  client = new BigQuery({
    projectId: process.env.GOOGLE_PROJECT_ID,
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
  });
  return client;
}

const LOCATION = process.env.BQ_LOCATION ?? 'asia-northeast3';

// 쿼리당 스캔 상한 3GB — 초과 시 과금 대신 에러로 실패시킨다
const MAX_BYTES_BILLED = '3000000000';

export async function runQuery<T>(query: string, params?: Record<string, unknown>): Promise<T[]> {
  const [rows] = await bq().query({
    query,
    params,
    location: LOCATION,
    maximumBytesBilled: MAX_BYTES_BILLED,
  });
  return rows as T[];
}
