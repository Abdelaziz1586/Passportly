import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter<SMTPTransport.SentMessageInfo> | null;
  private readonly from: string;
  private readonly appBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('mail.host', '').trim();
    const port = this.configService.get<number>('mail.port', 587);
    const secure = this.configService.get<boolean>('mail.secure', false);
    const user = this.configService.get<string>('mail.user', '').trim();
    const pass = this.configService.get<string>('mail.pass', '');
    this.from = this.configService.get<string>(
      'mail.from',
      'Passportly <no-reply@passportly.local>',
    );
    this.appBaseUrl = this.configService
      .get<string>('mail.appBaseUrl', 'http://localhost:3000')
      .replace(/\/+$/, '');

    if (!this.isConfigured(host, user, pass)) {
      this.transporter = null;
      return;
    }

    const transportOptions: SMTPTransport.Options = {
      host,
      port,
      secure,
      ...(user && pass ? { auth: { user, pass } } : {}),
    };

    this.transporter = nodemailer.createTransport(transportOptions);
  }

  private isConfigured(host: string, user: string, pass: string): boolean {
    if (!host || host === 'smtp.example.com') {
      return false;
    }
    if (user === 'replace_me' || pass === 'replace_me') {
      return false;
    }
    return true;
  }

  async sendVerificationEmail(params: {
    to: string;
    firstName: string;
    token: string;
  }): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(
        `SMTP is not configured; skipping verification email for ${params.to}`,
      );
      return false;
    }

    const verificationUrl = `${this.appBaseUrl}/api/auth/verify-email?emailVerificationToken=${encodeURIComponent(params.token)}`;
    const safeFirstName = escapeHtml(params.firstName);

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: params.to,
        subject: 'Verify your Passportly email address',
        text: `Hi ${params.firstName},\n\nPlease verify your Passportly email address by opening the link below:\n${verificationUrl}\n\nIf you did not create an account, you can ignore this email.`,
        html: `<p>Hi ${safeFirstName},</p><p>Please verify your Passportly email address by clicking the link below:</p><p><a href="${verificationUrl}">Verify Email Address</a></p><p>If you did not create an account, you can safely ignore this email.</p>`,
      });
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to send verification email to ${params.to}: ${message}`,
      );
      return false;
    }
  }

  async sendPasswordResetEmail(params: {
    to: string;
    firstName: string;
    token: string;
    expiresInMinutes: number;
  }): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(
        `SMTP is not configured; skipping password reset email for ${params.to}`,
      );
      return false;
    }

    const resetUrl = `${this.appBaseUrl}/reset-password?token=${encodeURIComponent(params.token)}`;
    const safeFirstName = escapeHtml(params.firstName);

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: params.to,
        subject: 'Reset your Passportly password',
        text: `Hi ${params.firstName},\n\nWe received a request to reset your Passportly password. Use the link below within ${params.expiresInMinutes} minutes:\n${resetUrl}\n\nIf you did not request a password reset, you can safely ignore this email.`,
        html: `<p>Hi ${safeFirstName},</p><p>We received a request to reset your Passportly password. Click the link below within ${params.expiresInMinutes} minutes:</p><p><a href="${resetUrl}">Reset Password</a></p><p>If you did not request a password reset, you can safely ignore this email.</p>`,
      });
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to send password reset email to ${params.to}: ${message}`,
      );
      return false;
    }
  }
}
