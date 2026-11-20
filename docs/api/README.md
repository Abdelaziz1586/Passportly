# API Documentation

API documentation and exported OpenAPI/Swagger specifications can be stored here.
Swagger UI is served live by the NestJS backend at `/api/docs`.

## Flight cancellation integration

Hold and payment-confirmation transactions must call `FlightsService.lockScheduledFlight` for each flight leg in stable ID order before changing inventory. If a Stripe payment succeeds after a provider cancellation invalidates its hold, record the verified payment and call `FlightsService.queuePaymentAfterCancellation` in the same transaction. Skip booking confirmation when the method returns true. Stripe refunds run after commit.
