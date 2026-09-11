# Decisiones de APIs externas - GIT Week 2026

Recomendaciones de APIs gratuitas (o con tier gratuito suficiente) para el
proyecto de e-commerce del 2º GIT Week 2026.

---

## 1. Pagos en Perú

| API | Tier gratuito | Ideal para | Veredicto |
|-----|--------------|------------|-----------|
| **Culqi** | Sin comisión por transacción; 3.4% + S/0.50 solo al cobrar | Checkout locales con tarjeta (Visa, Mastercard, Yape) | **Recomendado** — simplify peruano, soporte en español, sin costos fijos |
| **MercadoPago** | 4.99% + S/0.40 por transacción; sin mensualidad | Checkout con Yape, plin, tarjeta | Alternativa si se necesita Yape directo |
| **Stripe** | 2.9% + $0.30 por transacción (USD) | Checkout internacional | No recomendado: cobra en USD, sin integración directa con Yape/Plin |
| **Niubiz (Visa)** | Negociación directa; no hay tier público gratuito | Alto volumen | No recomendado: requiere contrato comercial |

**Decisión:** Culqi para pagos con tarjeta. Si se necesita Yape/Plin, usar MercadoPago como
complemento. Ambos ofrecen SDKs de JavaScript/Node.js y APIs REST.

---

## 2. Envío de correos electrónicos

| API | Tier gratuito | Ideal para | Veredicto |
|-----|--------------|------------|-----------|
| **Resend** | 100 emails/día, 3,000/mes | Transaccionales (confirmación de compra, factura) | **Recomendado** — simple, sin setup de dominio para empezar, SDK Node |
| **Brevo (ex-Sendinblue)** | 300 emails/día | Marketing + transaccional | Alternativa con plantillas drag-and-drop |
| **Mailgun** | 1,000 emails/mes | Transaccional | Requiere verificación de dominio desde el día 1 |
| **Nodemailer (local SMTP)** | Infinito (self-hosted) | Desarrollo local | Solo para dev; no recomendado en producción |

**Decisión:** Resend para transaccionales. Si el volumen crece, migrar a Brevo.

---

## 3. Notificaciones SMS

| API | Tier gratuito | Ideal para | Veredicto |
|-----|--------------|------------|-----------|
| **Twilio** | $15 USD de crédito para prueba (~200 SMS) | Verificación 2FA, alertas de compra | **Aceptable** para MVP; se agota rápido |
| **Vonage (Nexmo)** | €2 de crédito | SMS + WhatsApp | Mismo problema: se agota |
| **Infobip** | 100 SMS/mes (plan gratuito) | SMS + WhatsApp + email | **Recomendado** para MVP — más generoso |
| **AWS SNS** | 100 SMS gratuitos/mes (primeros 12 meses) | SMS en la nube | Aceptable si ya se usa AWS |

**Decisión:** Infobip para MVP (100 SMS/mes cubre notificaciones de compra).
Si se necesita más volumen, Twilio o AWS SNS.

---

## 4. Códigos QR

| Librería/Servicio | Tier gratuito | Ideal para | Veredicto |
|-------------------|--------------|------------|-----------|
| **qrcode (npm)** | Gratuito (local) | Generar QR de cupones, links, pagos | **Ya integrado** — local, sin dependencia externa |
| **QR Server API** | Gratuito | QR dinámicos vía URL | No necesario; el npm genera imágenes PNG/SVG |
| **ZXing** | Gratuito (Java/JS) | Escanear QR | Solo si se necesita lectura |

**Decisión:** La librería `qrcode` (ya instalada) es suficiente. No se necesita
un servicio externo para QR.

---

## 5. Almacenamiento de imágenes

| API | Tier gratuito | Ideal para | Veredicto |
|-----|--------------|------------|-----------|
| **Cloudinary** | 25 GB almacenamiento, 25K transformaciones/mes | Fotos de productos, logos de sponsors | **Recomendado** — CDN incluido |
| **Uploadcare** | 3 GB, 3 GB de tráfico/mes | Upload + CDN | Alternativa si se necesita upload directo del usuario |
| **Cloudflare R2** | 10 GB, 10M lecturas/mes | Almacenamiento puro | Más barato que S3; sin egress fees |

**Decisión:** Cloudinary para imágenes de producto (ya tiene transformaciones automáticas).
Si el volumen es bajo, Cloudflare R2 es la alternativa más económica.

---

## 6. Monitoreo de errores

| API | Tier gratuito | Ideal para | Veredicto |
|-----|--------------|------------|-----------|
| **Sentry** | 5,000 errores/mes, 1 usuario | Tracking de errores backend + frontend | **Recomendado** — SDK NestJS oficial |
| **LogRocket** | 1,000 sesiones/mes | Grabación de sesiones frontend | Complemento útil para debugging UI |
| **Axiom** | 1 GB de logs/mes | Logs estructurados | Alternativa a Sentry para logs |

**Decisión:** Sentry (ya integrado patrón recomendado en NestJS). Si se necesita
observabilidad de logs, Axiom como complemento.

---

## Resumen de integración

| Categoría | API seleccionada | Estado |
|-----------|-----------------|--------|
| Pagos | Culqi | Pendiente de integrar (Fase 13) |
| Email | Resend | Pendiente de integrar |
| SMS | Infobip | Pendiente de integrar (si es necesario) |
| QR | qrcode (npm) | **Ya integrado** |
| Imágenes | Cloudinary | Pendiente de integrar |
| Errores | Sentry | Pendiente de integrar (Fase 15) |

---

## Notas para la integración

1. **Todas las APIs listadas son gratuitas** o tienen tier gratuito suficiente
   para el volumen esperado del GIT Week (~100-500 usuarios).
2. **Sin compromiso de vendor lock-in**: todas ofrecen APIs REST estándar y
   SDKs oficiales en JavaScript/TypeScript.
3. **En producción**, los secrets de estas APIs se configuran vía variables de
   entorno (NUNCA en código fuente ni en docker-compose.yml).
4. **El modo demo actual no necesita estas APIs** — funciona con el simulador
   sandbox integrado. Las APIs externas se activan al configurar los secrets
   correspondientes.
