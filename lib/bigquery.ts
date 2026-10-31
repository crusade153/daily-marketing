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

/**
 * BigQuery 클라이언트 오류에는 응답 스트림(zlib Gunzip)이 붙어 있어, 개발 서버가 오류를 브라우저로 넘기며
 * 속성을 훑을 때 Node 경고(DEP0108 zlib.bytesRead)가 난다. 메시지·코드·사유만 남긴 오류로 바꿔 던진다.
 */
function cleanError(e: unknown): Error {
  if (!(e instanceof Error)) return new Error(`BigQuery 조회 실패: ${String(e)}`);
  const src = e as Error & { code?: unknown; errors?: { reason?: unknown; message?: unknown }[] };
  const out = new Error(`BigQuery 조회 실패: ${e.message}`) as Error & { code?: unknown; reasons?: string[] };
  out.code = src.code;
  out.reasons = Array.isArray(src.errors) ? src.errors.map((x) => String(x?.reason ?? x?.message ?? '')) : undefined;
  return out;
}

export async function runQuery<T>(query: string, params?: Record<string, unknown>): Promise<T[]> {
  try {
    const [rows] = await bq().query({
      query,
      params,
      location: LOCATION,
      maximumBytesBilled: MAX_BYTES_BILLED,
    });
    return rows as T[];
  } catch (e) {
    throw cleanError(e);
  }
}
