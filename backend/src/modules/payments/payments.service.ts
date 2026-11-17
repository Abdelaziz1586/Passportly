import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Stripe from 'stripe';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { Refund, RefundDocument } from './schemas/refund.schema';

@Injectable()
export class PaymentsService {
  readonly stripe: Stripe | null;

  constructor(
    @InjectModel(Payment.name) readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Refund.name) readonly refundModel: Model<RefundDocument>,
    readonly configService: ConfigService,
  ) {
    const secretKey = this.configService.get<string>('stripe.secretKey', '');
    this.stripe = secretKey ? new Stripe(secretKey) : null;
  }
}
