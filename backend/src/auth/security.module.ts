import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthGuard } from "./auth.guard";

/**
 * Shared security wiring: every feature module that guards its controllers
 * with `AuthGuard` imports this module so the guard's `JwtService`
 * (and Prisma, via the global PrismaModule) resolve correctly.
 */
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: "7d" },
    }),
  ],
  providers: [AuthGuard],
  exports: [AuthGuard, JwtModule],
})
export class SecurityModule {}
