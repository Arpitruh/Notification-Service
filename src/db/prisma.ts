import dns from 'node:dns/promises';
import { Pool, type PoolConfig } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ENV } from '../config/env.js';

// Neon requires TLS and presents a valid CA chain, so we verify the certificate.
//
// IPv4 workaround: the Neon hostname resolves to both IPv4 (A) and IPv6 (AAAA)
// addresses. Some environments (e.g. WSL) have no working IPv6 route, so any
// attempt on an AAAA address fails fast with ETIMEDOUT. Node's default DNS
// ordering and pg's `lookup` option both proved unreliable here. The robust fix
// is to resolve the host to an IPv4 literal ourselves and connect to that,
// while keeping the original hostname as the TLS servername (SNI) so certificate
// validation still works against the real host.
const url = new URL(ENV.DATABASE_URL);
const originalHost = url.hostname;

let host = originalHost;
try {
  const [ipv4] = await dns.resolve4(originalHost);
  if (ipv4) host = ipv4;
} catch {
  // Fall back to the hostname; the pool will do its own DNS resolution.
}

const config: PoolConfig = {
  host,
  port: Number(url.port || 5432),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  // TLS is mandatory in production. Local ephemeral Postgres in CI may opt out.
  ssl: url.searchParams.get('sslmode') === 'disable' && process.env.NODE_ENV !== 'production'
    ? false
    : { rejectUnauthorized: true, servername: originalHost },
};

const pool = new Pool(config);

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
