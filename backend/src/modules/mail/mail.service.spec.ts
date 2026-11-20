import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('MailService', () => {
  const createTransportMock = nodemailer.createTransport as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createConfigService(
    overrides: Record<string, unknown>,
  ): ConfigService {
    const values: Record<string, unknown> = {
      'mail.host': '',
      'mail.port': 587,
      'mail.secure': false,
      'mail.user': '',
      'mail.pass': '',
      'mail.from': 'Passportly <no-reply@passportly.local>',
      'mail.appBaseUrl': 'http://localhost:3000',
      ...overrides,
    };
    return {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        key in values ? values[key] : defaultValue,
      ),
    } as unknown as ConfigService;
  }

  it('skips sending when SMTP host is placeholder or unconfigured', async () => {
    const configService = createConfigService({
      'mail.host': 'smtp.example.com',
      'mail.user': 'replace_me',
      'mail.pass': 'replace_me',
    });

    const mailService = new MailService(configService);
    const sent = await mailService.sendVerificationEmail({
      to: 'traveler@example.com',
      firstName: 'Abdelaziz',
      token: 'token-123',
    });

    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sent).toBe(false);
  });

  it('sends verification email via configured custom SMTP server', async () => {
    const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'msg-1' });
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });

    const configService = createConfigService({
      'mail.host': 'sandbox.smtp.mailtrap.io',
      'mail.port': 2525,
      'mail.secure': false,
      'mail.user': 'smtp-user',
      'mail.pass': 'smtp-pass',
      'mail.from': 'Passportly <no-reply@passportly.dev>',
      'mail.appBaseUrl': 'http://localhost:3000/',
    });

    const mailService = new MailService(configService);
    const sent = await mailService.sendVerificationEmail({
      to: 'traveler@example.com',
      firstName: 'Abdelaziz <script>',
      token: 'verify-token-abc',
    });

    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'sandbox.smtp.mailtrap.io',
      port: 2525,
      secure: false,
      auth: {
        user: 'smtp-user',
        pass: 'smtp-pass',
      },
    });
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    const callArgs = (
      sendMailMock.mock.calls as [[Record<string, string>]]
    )[0][0];
    expect(callArgs.to).toBe('traveler@example.com');
    expect(callArgs.from).toBe('Passportly <no-reply@passportly.dev>');
    expect(callArgs.text).toContain(
      'http://localhost:3000/api/auth/verify-email?emailVerificationToken=verify-token-abc',
    );
    expect(callArgs.html).toContain('Abdelaziz &lt;script&gt;');
    expect(sent).toBe(true);
  });

  it('returns false gracefully when SMTP delivery fails', async () => {
    const sendMailMock = jest
      .fn()
      .mockRejectedValue(new Error('Connection refused'));
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });

    const configService = createConfigService({
      'mail.host': 'smtp.custom.local',
      'mail.port': 1025,
      'mail.secure': false,
    });

    const mailService = new MailService(configService);
    const sent = await mailService.sendVerificationEmail({
      to: 'traveler@example.com',
      firstName: 'Abdelaziz',
      token: 'verify-token-abc',
    });

    expect(sent).toBe(false);
  });

  it('sends password reset email via configured custom SMTP server', async () => {
    const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'msg-2' });
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });

    const configService = createConfigService({
      'mail.host': 'smtp.custom.local',
      'mail.port': 587,
      'mail.secure': false,
      'mail.user': 'smtp-user',
      'mail.pass': 'smtp-pass',
      'mail.appBaseUrl': 'http://localhost:3001/',
    });

    const mailService = new MailService(configService);
    const sent = await mailService.sendPasswordResetEmail({
      to: 'traveler@example.com',
      firstName: 'Abdelaziz <script>',
      token: 'reset-token-xyz',
      expiresInMinutes: 15,
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const callArgs = (
      sendMailMock.mock.calls as [[Record<string, string>]]
    )[0][0];
    expect(callArgs.to).toBe('traveler@example.com');
    expect(callArgs.subject).toBe('Reset your Passportly password');
    expect(callArgs.text).toContain(
      'http://localhost:3001/reset-password?token=reset-token-xyz',
    );
    expect(callArgs.text).toContain('15 minutes');
    expect(callArgs.html).toContain('Abdelaziz &lt;script&gt;');
    expect(sent).toBe(true);
  });

  it('skips sending password reset email when SMTP is unconfigured', async () => {
    const configService = createConfigService({
      'mail.host': 'smtp.example.com',
      'mail.user': 'replace_me',
      'mail.pass': 'replace_me',
    });

    const mailService = new MailService(configService);
    const sent = await mailService.sendPasswordResetEmail({
      to: 'traveler@example.com',
      firstName: 'Abdelaziz',
      token: 'reset-token-xyz',
      expiresInMinutes: 15,
    });

    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sent).toBe(false);
  });
});
