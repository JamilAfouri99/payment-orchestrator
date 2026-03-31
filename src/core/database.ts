import { PrismaClient } from "@prisma/client";

let prismaInstance: PrismaClient | null = null;

/**
 * Returns the singleton PrismaClient instance.
 * @returns PrismaClient connected to the configured database
 */
export function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient();
  }
  return prismaInstance;
}

/**
 * Disconnects the PrismaClient. Call during graceful shutdown.
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}
