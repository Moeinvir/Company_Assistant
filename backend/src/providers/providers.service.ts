import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ProviderId, SetProviderKeyDto } from "./providers.dto";

@Injectable()
export class ProvidersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, workspaceId: string) {
    await this.requireWorkspace(userId, workspaceId);
    const credentials = await this.prisma.providerCredential.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
    });
    return credentials.map((entry) => this.serialize(entry));
  }

  async set(userId: string, input: SetProviderKeyDto) {
    await this.requireWorkspace(userId, input.workspaceId);
    const secret = process.env.PROVIDER_KEYS_ENCRYPTION_SECRET;
    if (!secret || secret.length < 32) {
      throw new InternalServerErrorException(
        "PROVIDER_KEYS_ENCRYPTION_SECRET must be set to at least 32 characters",
      );
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
    const encryptedKey = Buffer.concat([
      cipher.update(input.apiKey, "utf8"),
      cipher.final(),
    ]).toString("base64");
    const authTag = cipher.getAuthTag().toString("base64");
    const record = await this.prisma.providerCredential.upsert({
      where: {
        workspaceId_provider: { workspaceId: input.workspaceId, provider: input.provider },
      },
      create: {
        workspaceId: input.workspaceId,
        provider: input.provider,
        encryptedKey,
        iv: iv.toString("base64"),
        authTag,
        maskedKey: `••••${input.apiKey.slice(-4)}`,
        baseUrl: input.baseUrl,
      },
      update: {
        encryptedKey,
        iv: iv.toString("base64"),
        authTag,
        maskedKey: `••••${input.apiKey.slice(-4)}`,
        baseUrl: input.baseUrl,
        status: "configured",
        note: null,
      },
    });
    return this.serialize(record);
  }

  async remove(userId: string, workspaceId: string, provider: ProviderId) {
    await this.requireWorkspace(userId, workspaceId);
    await this.prisma.providerCredential.deleteMany({ where: { workspaceId, provider } });
  }

  async markVerified(
    userId: string,
    workspaceId: string,
    provider: ProviderId,
    result: { ok: boolean; message: string },
  ) {
    await this.requireWorkspace(userId, workspaceId);
    const credential = await this.prisma.providerCredential.findUnique({
      where: { workspaceId_provider: { workspaceId, provider } },
    });
    if (!credential) throw new NotFoundException("Provider key not found");
    const updated = await this.prisma.providerCredential.update({
      where: { id: credential.id },
      data: {
        status: result.ok ? "verified" : "invalid",
        note: result.message,
        lastCheckedAt: new Date(),
      },
    });
    return this.serialize(updated);
  }

  private async requireWorkspace(userId: string, workspaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { workspaceId: true },
    });
    if (!membership) throw new NotFoundException("Workspace not found");
  }

  private serialize(record: {
    id: string;
    workspaceId: string;
    provider: string;
    maskedKey: string;
    status: string;
    baseUrl: string | null;
    lastCheckedAt: Date | null;
    note: string | null;
    updatedAt: Date;
  }) {
    return {
      id: record.id,
      workspaceId: record.workspaceId,
      provider: record.provider as ProviderId,
      maskedKey: record.maskedKey,
      status: record.status,
      ...(record.baseUrl ? { baseUrl: record.baseUrl } : {}),
      lastCheckedAt: record.lastCheckedAt?.toISOString() ?? null,
      note: record.note,
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
