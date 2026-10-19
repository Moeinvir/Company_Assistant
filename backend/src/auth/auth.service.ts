import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import { WorkspacePlan, WorkspaceRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { SignInDto, SignUpDto, UpdateProfileDto } from "./auth.dto";

const SESSION_DAYS = 7;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async signUp(input: SignUpDto) {
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException("An account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const slugBase = input.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "workspace";
    const tokenId = randomUUID();
    let userId = "";
    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          name: input.name.trim(),
          passwordHash,
          memberships: {
            create: {
              role: WorkspaceRole.owner,
              workspace: {
                create: {
                  name: `${input.name.trim()}'s workspace`,
                  slug: `${slugBase}-${randomUUID().slice(0, 8)}`,
                  plan: WorkspacePlan.trial,
                },
              },
            },
          },
          sessions: { create: { tokenId, expiresAt: this.expiration() } },
        },
      });
      userId = user.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("An account with this email already exists");
      }
      throw error;
    }
    return this.authResult(userId, tokenId);
  }

  async signIn(input: SignInDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
    });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException("Email or password is incorrect");
    }
    const tokenId = randomUUID();
    await this.prisma.session.create({
      data: { tokenId, userId: user.id, expiresAt: this.expiration() },
    });
    return this.authResult(user.id, tokenId);
  }

  async restore(userId: string, tokenId: string) {
    return this.authResult(userId, tokenId);
  }

  async signOut(tokenId: string) {
    await this.prisma.session.deleteMany({ where: { tokenId } });
  }

  /**
   * Profile edits (display name, picture) for the signed-in account. The
   * picture is stored as a data URL or an https URL and is never fetched
   * server-side.
   */
  async updateProfile(userId: string, input: UpdateProfileDto) {
    const image = input.image?.trim();
    if (input.image !== undefined && image && !/^(https:\/\/|data:image\/)/.test(image)) {
      throw new BadRequestException("That picture is not a valid image URL");
    }
    const name = input.name === undefined ? undefined : input.name.trim();
    if (input.name !== undefined && !name) throw new BadRequestException("Enter a display name");

    const membership = await this.prisma.membership.findFirst({
      where: { userId },
      orderBy: { joinedAt: "asc" },
      select: { role: true },
    });

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(input.image !== undefined ? { image: image || null } : {}),
      },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      ...(user.image ? { image: user.image } : {}),
      role: membership?.role ?? WorkspaceRole.member,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private expiration() {
    return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  }

  private async authResult(userId: string, tokenId: string) {
    const [user, membership] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.prisma.membership.findFirst({
        where: { userId },
        orderBy: { joinedAt: "asc" },
        include: { workspace: { include: { memberships: { select: { userId: true, role: true } } } } },
      }),
    ]);
    if (!membership) throw new UnauthorizedException("Account has no workspace");

    const expiresAt = this.expiration();
    const token = await this.jwt.signAsync(
      { sub: user.id, jti: tokenId },
      { expiresIn: `${SESSION_DAYS}d` },
    );
    return {
      session: {
        token,
        expiresAt: expiresAt.toISOString(),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          ...(user.image ? { image: user.image } : {}),
          role: membership.role,
          createdAt: user.createdAt.toISOString(),
        },
      },
      workspace: this.serializeWorkspace(membership.workspace),
      workspaces: (await this.prisma.workspace.findMany({
        where: { memberships: { some: { userId } } },
        include: { memberships: { select: { userId: true, role: true } } },
        orderBy: { createdAt: "asc" },
      })).map((workspace) => this.serializeWorkspace(workspace)),
    };
  }

  private serializeWorkspace(
    workspace: {
      id: string;
      name: string;
      slug: string;
      plan: WorkspacePlan;
      createdAt: Date;
      memberships: { userId: string; role: WorkspaceRole }[];
    },
  ) {
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      plan: workspace.plan,
      ownerId: workspace.memberships.find(({ role }) => role === WorkspaceRole.owner)?.userId ?? "",
      memberIds: workspace.memberships.map(({ userId }) => userId),
      isSample: false,
      createdAt: workspace.createdAt.toISOString(),
    };
  }
}
