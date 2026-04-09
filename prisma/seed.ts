import { PrismaClient, UserRole, ClientStatus, Platform, ConnectionStatus, PostingMode } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create admin user
  const adminPassword = await bcrypt.hash("admin123", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@gershonconsulting.com" },
    update: {},
    create: {
      name: "Admin User",
      email: "admin@gershonconsulting.com",
      password: adminPassword,
      role: UserRole.ADMIN,
      isActive: true,
    },
  });
  console.log("Created admin user:", admin.email);

  // Create operations user
  const opsPassword = await bcrypt.hash("ops123", 12);
  const ops = await prisma.user.upsert({
    where: { email: "ops@gershonconsulting.com" },
    update: {},
    create: {
      name: "Operations User",
      email: "ops@gershonconsulting.com",
      password: opsPassword,
      role: UserRole.OPERATIONS,
      isActive: true,
    },
  });
  console.log("Created operations user:", ops.email);

  // Create Gershon Consulting client
  const client = await prisma.client.upsert({
    where: { slug: "gershon-consulting" },
    update: {},
    create: {
      slug: "gershon-consulting",
      name: "Gershon Consulting",
      timezone: "America/New_York",
      status: ClientStatus.ACTIVE,
      campaignStartDate: new Date("2026-01-01"),
      reportingStartDate: new Date("2026-01-01"),
      internalOwner: "Admin User",
      website: "https://gershonconsulting.com",
      industry: "Consulting",
      notes: "First test client — backfill from January 1, 2026.",
    },
  });
  console.log("Created client:", client.name);

  // Create platform connections for Gershon Consulting
  const platforms: { platform: Platform; name: string; mandatory: boolean }[] = [
    { platform: Platform.LINKEDIN, name: "LinkedIn Company Page", mandatory: true },
    { platform: Platform.TWITTER, name: "X / Twitter", mandatory: true },
    { platform: Platform.GOOGLE_BUSINESS, name: "Google Business Profile", mandatory: true },
  ];

  for (const p of platforms) {
    const conn = await prisma.platformConnection.upsert({
      where: { clientId_platform: { clientId: client.id, platform: p.platform } },
      update: {},
      create: {
        clientId: client.id,
        platform: p.platform,
        externalAccountName: `Gershon Consulting — ${p.name}`,
        isMandatory: p.mandatory,
        isEnabled: true,
        connectionStatus: ConnectionStatus.PENDING,
        enforcementStartDate: new Date("2026-01-01"),
        notes: `Pending OAuth connection for ${p.name}`,
      },
    });
    console.log(`Created platform connection: ${p.name}`);

    // Create posting schedule
    await prisma.postingSchedule.upsert({
      where: { id: `schedule-${client.id}-${p.platform}` },
      update: {},
      create: {
        id: `schedule-${client.id}-${p.platform}`,
        clientId: client.id,
        platformConnectionId: conn.id,
        mode: PostingMode.WORKING_DAYS,
        useWorkingDays: true,
      },
    });
    console.log(`Created posting schedule for ${p.name}`);
  }

  console.log("\nSeed completed successfully!");
  console.log("Admin login: admin@gershonconsulting.com / admin123");
  console.log("Ops login:   ops@gershonconsulting.com / ops123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
