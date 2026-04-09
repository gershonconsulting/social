-- ============================================================
-- social.gershonCRM.com — Database Schema + Seed
-- Run this in Neon SQL Editor (neon.tech → SQL Editor)
-- ============================================================

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATIONS', 'READ_ONLY');
CREATE TYPE "ClientStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'INCOMPLETE_SETUP', 'ARCHIVED');
CREATE TYPE "Platform" AS ENUM ('LINKEDIN', 'TWITTER', 'GOOGLE_BUSINESS', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'THREADS', 'PINTEREST', 'MEDIUM', 'REDDIT', 'BLOG_RSS', 'OTHER');
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'EXPIRED', 'ERROR', 'PENDING');
CREATE TYPE "PostingMode" AS ENUM ('EVERY_DAY', 'WORKING_DAYS', 'CUSTOM_WEEKDAYS', 'CUSTOM_TARGET');
CREATE TYPE "ComplianceStatus" AS ENUM ('GREEN', 'RED', 'YELLOW', 'GRAY');
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');
CREATE TYPE "SyncJobType" AS ENUM ('POST_SYNC', 'FOLLOWER_SNAPSHOT', 'COMPLIANCE_RECOMPUTE', 'BACKFILL', 'TOKEN_HEALTH_CHECK', 'MONTHLY_REPORT');
CREATE TYPE "SyncScopeType" AS ENUM ('ALL', 'CLIENT', 'PLATFORM_CONNECTION', 'DATE_RANGE');
CREATE TYPE "AuditAction" AS ENUM ('CLIENT_CREATED', 'CLIENT_UPDATED', 'CLIENT_ARCHIVED', 'CLIENT_RESTORED', 'PLATFORM_CONNECTED', 'PLATFORM_DISCONNECTED', 'PLATFORM_REQUIREMENT_CHANGED', 'POSTING_CALENDAR_CHANGED', 'MANUAL_SYNC_TRIGGERED', 'BACKFILL_TRIGGERED', 'REPORT_EXPORTED', 'USER_CREATED', 'USER_UPDATED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OPERATIONS',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "status" "ClientStatus" NOT NULL DEFAULT 'DRAFT',
    "campaignStartDate" TIMESTAMP(3),
    "reportingStartDate" TIMESTAMP(3),
    "internalOwner" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "billingStatus" TEXT,
    "contractStatus" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archiveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_connections" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalAccountId" TEXT,
    "externalAccountName" TEXT,
    "externalAccountUrl" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "connectionStatus" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "tokenReference" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "enforcementStartDate" TIMESTAMP(3),
    "enforcementEndDate" TIMESTAMP(3),
    "notes" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "posting_schedules" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "platformConnectionId" TEXT NOT NULL,
    "mode" "PostingMode" NOT NULL DEFAULT 'WORKING_DAYS',
    "weekdaysJson" TEXT,
    "useWorkingDays" BOOLEAN NOT NULL DEFAULT true,
    "holidayCalendarJson" TEXT,
    "exclusionDatesJson" TEXT,
    "customTargetCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "posting_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_posts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "platformConnectionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalPostId" TEXT NOT NULL,
    "postUrl" TEXT,
    "postTextSnippet" TEXT,
    "hasMedia" BOOLEAN NOT NULL DEFAULT false,
    "publishedAtUtc" TIMESTAMP(3) NOT NULL,
    "publishedAtLocal" TIMESTAMP(3) NOT NULL,
    "publishedDateLocal" TEXT NOT NULL,
    "rawPayloadJson" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_compliance" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "platformConnectionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "dateLocal" TEXT NOT NULL,
    "expectedFlag" BOOLEAN NOT NULL DEFAULT false,
    "status" "ComplianceStatus" NOT NULL DEFAULT 'GRAY',
    "verifiedPostCount" INTEGER NOT NULL DEFAULT 0,
    "primaryPostId" TEXT,
    "primaryPostUrl" TEXT,
    "verificationSource" TEXT,
    "verificationErrorCode" TEXT,
    "verificationErrorMsg" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_compliance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "follower_snapshots" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "platformConnectionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "snapshotDateLocal" TEXT NOT NULL,
    "followerCount" INTEGER NOT NULL,
    "followingCount" INTEGER,
    "extraMetricsJson" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "follower_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "jobType" "SyncJobType" NOT NULL,
    "scopeType" "SyncScopeType" NOT NULL DEFAULT 'ALL',
    "scopeId" TEXT,
    "clientId" TEXT,
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "itemsSucceeded" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "errorLogJson" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actionType" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "clients_slug_key" ON "clients"("slug");
CREATE UNIQUE INDEX "platform_connections_clientId_platform_key" ON "platform_connections"("clientId", "platform");
CREATE INDEX "social_posts_clientId_platform_publishedDateLocal_idx" ON "social_posts"("clientId", "platform", "publishedDateLocal");
CREATE UNIQUE INDEX "social_posts_clientId_platform_externalPostId_key" ON "social_posts"("clientId", "platform", "externalPostId");
CREATE INDEX "daily_compliance_clientId_dateLocal_idx" ON "daily_compliance"("clientId", "dateLocal");
CREATE INDEX "daily_compliance_platform_dateLocal_idx" ON "daily_compliance"("platform", "dateLocal");
CREATE UNIQUE INDEX "daily_compliance_clientId_platformConnectionId_dateLocal_key" ON "daily_compliance"("clientId", "platformConnectionId", "dateLocal");
CREATE INDEX "follower_snapshots_clientId_platform_idx" ON "follower_snapshots"("clientId", "platform");
CREATE UNIQUE INDEX "follower_snapshots_clientId_platformConnectionId_snapshotDa_key" ON "follower_snapshots"("clientId", "platformConnectionId", "snapshotDateLocal");
CREATE INDEX "sync_jobs_clientId_status_idx" ON "sync_jobs"("clientId", "status");
CREATE INDEX "sync_jobs_jobType_startedAt_idx" ON "sync_jobs"("jobType", "startedAt");
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- Foreign Keys
ALTER TABLE "platform_connections" ADD CONSTRAINT "platform_connections_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "posting_schedules" ADD CONSTRAINT "posting_schedules_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "posting_schedules" ADD CONSTRAINT "posting_schedules_platformConnectionId_fkey" FOREIGN KEY ("platformConnectionId") REFERENCES "platform_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_platformConnectionId_fkey" FOREIGN KEY ("platformConnectionId") REFERENCES "platform_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_compliance" ADD CONSTRAINT "daily_compliance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_compliance" ADD CONSTRAINT "daily_compliance_platformConnectionId_fkey" FOREIGN KEY ("platformConnectionId") REFERENCES "platform_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "follower_snapshots" ADD CONSTRAINT "follower_snapshots_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "follower_snapshots" ADD CONSTRAINT "follower_snapshots_platformConnectionId_fkey" FOREIGN KEY ("platformConnectionId") REFERENCES "platform_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- SEED DATA
-- ============================================================

-- Users (admin123 and ops123 — change passwords after first login)
INSERT INTO "users" ("id","name","email","password","role","isActive","createdAt","updatedAt") VALUES
  ('user_admin_001','Admin User','admin@gershonconsulting.com','$2a$12$EpZ.ohB5978aJoYK/616.OWJQPRqMx0AycD1e.HFSK7Y9kM64hzda','ADMIN',true,NOW(),NOW()),
  ('user_ops_001','Operations User','ops@gershonconsulting.com','$2a$12$ZfFaKWT9BEabqnXGRwsF3..4tBcqL6HTosTb6xl795jET7U5kQjQi','OPERATIONS',true,NOW(),NOW());

-- Gershon Consulting client
INSERT INTO "clients" ("id","slug","name","timezone","status","campaignStartDate","reportingStartDate","internalOwner","website","industry","notes","createdAt","updatedAt") VALUES
  ('client_gc_001','gershon-consulting','Gershon Consulting','America/New_York','ACTIVE','2026-01-01','2026-01-01','Admin User','https://gershonconsulting.com','Consulting','First test client — backfill from January 1, 2026.',NOW(),NOW());

-- Platform connections
INSERT INTO "platform_connections" ("id","clientId","platform","externalAccountName","isMandatory","isEnabled","connectionStatus","enforcementStartDate","notes","createdAt","updatedAt") VALUES
  ('conn_gc_li','client_gc_001','LINKEDIN','Gershon Consulting — LinkedIn Company Page',true,true,'PENDING','2026-01-01','Pending OAuth connection',NOW(),NOW()),
  ('conn_gc_tw','client_gc_001','TWITTER','Gershon Consulting — X / Twitter',true,true,'PENDING','2026-01-01','Pending OAuth connection',NOW(),NOW()),
  ('conn_gc_gb','client_gc_001','GOOGLE_BUSINESS','Gershon Consulting — Google Business Profile',true,true,'PENDING','2026-01-01','Pending OAuth connection',NOW(),NOW());

-- Posting schedules (working days)
INSERT INTO "posting_schedules" ("id","clientId","platformConnectionId","mode","useWorkingDays","createdAt","updatedAt") VALUES
  ('sched_gc_li','client_gc_001','conn_gc_li','WORKING_DAYS',true,NOW(),NOW()),
  ('sched_gc_tw','client_gc_001','conn_gc_tw','WORKING_DAYS',true,NOW(),NOW()),
  ('sched_gc_gb','client_gc_001','conn_gc_gb','WORKING_DAYS',true,NOW(),NOW());
