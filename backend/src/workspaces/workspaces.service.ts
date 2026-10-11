import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { CreateWorkspaceDto, UpdateWorkspaceDto } from "./workspaces.dto";

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const workspaces = await this.prisma.workspace.findMany({
      where: { memberships: { some: { userId } } },
      include: { memberships: { select: { userId: true, role: true } } },
      orderBy: { createdAt: "asc" },
    });
    return workspaces.map((workspace) => this.serialize(workspace));
  }

  async create(userId: string, input: CreateWorkspaceDto) {
    const workspace = await this.prisma.workspace.create({
      data: {
        name: input.name.trim(),
        slug: `${input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace"}-${randomUUID().slice(0, 8)}`,
        plan: input.plan,
        memberships: { create: { userId, role: "owner" } },
      },
      include: { memberships: { select: { userId: true, role: true } } },
    });
    return this.serialize(workspace);
  }

  async update(userId: string, workspaceId: string, patch: UpdateWorkspaceDto) {
    await this.requireMembership(userId, workspaceId);
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: patch,
      include: { memberships: { select: { userId: true, role: true } } },
    });
    return this.serialize(workspace);
  }

  async remove(userId: string, workspaceId: string) {
    const membership = await this.requireMembership(userId, workspaceId);
    if (membership.role !== "owner") throw new NotFoundException("Workspace not found");
    await this.prisma.workspace.delete({ where: { id: workspaceId } });
  }

  async members(userId: string, workspaceId: string) {
    await this.requireMembership(userId, workspaceId);
    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: "asc" },
    });
    return memberships.map(({ user, role, joinedAt }) => ({
      userId: user.id,
      name: user.name,
      email: user.email,
      role,
      joinedAt: joinedAt.toISOString(),
    }));
  }

  private async requireMembership(userId: string, workspaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!membership) throw new NotFoundException("Workspace not found");
    return membership;
  }

  private serialize(workspace: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    createdAt: Date;
    memberships: { userId: string; role: string }[];
  }) {
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      plan: workspace.plan,
      ownerId: workspace.memberships.find(({ role }) => role === "owner")?.userId ?? "",
      memberIds: workspace.memberships.map(({ userId }) => userId),
      isSample: false,
      createdAt: workspace.createdAt.toISOString(),
    };
  }
}
