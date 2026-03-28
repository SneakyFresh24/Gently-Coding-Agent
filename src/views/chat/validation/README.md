# Webview Message Validation Framework

Dieses Framework bietet robuste Sicherheit für die Verarbeitung von Webview-Nachrichten in der VS Code Extension.

## Überblick

Das Validation Framework schützt vor folgenden Sicherheitsbedrohungen:

- **Input Validation**: Überprüfung aller eingehenden Nachrichten auf korrekte Struktur und Typen
- **Rate Limiting**: Schutz vor Flood-Angriffen durch Begrenzung der Nachrichtenfrequenz
- **Size Limits**: Verhinderung von DoS-Angriffen durch große Nachrichten
- **Input Sanitization**: Bereinigung von potenziell schädlichen Inhalten
- **Type Guards**: Laufzeit-Validierung von TypeScript-Typen
- **Security Logging**: Protokollierung von Sicherheitsereignissen

## Komponenten

### MessageValidator

Die Hauptklasse, die alle Validierungsfunktionen bündelt:

```typescript
import { MessageValidator } from '../validation';

const validator = new MessageValidator({
  enableRateLimit: true,
  maxMessageSize: 1024 * 1024, // 1MB
  rateLimitWindow: 60000, // 1 Minute
  maxMessagesPerWindow: 100,
  enableSanitization: true,
  enableSecurityLogging: true
});

const result = validator.validateInboundMessage(message);
if (!result.isValid) {
  // Handle validation errors
  validator.showValidationErrors(result.errors);
}
```

### TypeGuards

Laufzeit-Typ-Validierungsfunktionen:

```typescript
import { TypeGuards } from '../validation';

// Prüft ob ein Objekt eine gültige Webview-Nachricht ist
if (TypeGuards.isInboundMessage(data)) {
  // Sicherer Zugriff auf message.type
}

// Validiert primitive Typen
if (TypeGuards.isValidString(email, 254)) {
  // Email ist gültig
}
```

### ValidationResult

Das Ergebnis der Validierung:

```typescript
interface ValidationResult {
  isValid: boolean;           // Ob die Nachricht gültig ist
  errors: ValidationError[];   // Liste der Fehler
  warnings: ValidationWarning[]; // Liste der Warnungen
  sanitizedData?: any;        // Bereinigte Daten
}
```

## Nachrichten-Schemas

Das Framework definiert Validierungsschemas für alle Nachrichtentypen:

### Mode-/Model-Nachrichten

```typescript
// Mode setzen (kanonischer Pfad)
{
  type: 'setMode',
  modeId: string // z.B. "architect" | "code"
}

// Legacy Alias (Übergangsweise)
{
  type: 'toggleAgentMode',
  enabled: boolean
}

// Modellwechsel
{
  type: 'modelChanged',
  model: string
}
```

### Chat-Nachrichten

```typescript
// Nachricht senden
{
  type: 'sendMessage',
  message: string,           // max 100KB
  fileReferences?: array[]    // optional, max 50 items
}
```

### Dateioperationen

```typescript
// Datei öffnen
{
  type: 'openFile',
  path: string  // max 1000 chars, wird bereinigt (path traversal protection)
}

// Dateien suchen
{
  type: 'searchFiles',
  query: string  // max 500 chars
}
```

### Terminal-Operationen

```typescript
// Command Approval
{
  type: 'commandApprovalResponse',
  commandId: string,  // max 100 chars
  approved: boolean
}

// Terminal Mode
{
  type: 'setTerminalMode',
  mode: 'manual' | 'smart'  // Enum-Validierung
}
```

## Sicherheitsfunktionen

### Rate Limiting

Schützt vor Flood-Angriffen:

```typescript
// Konfiguration
rateLimitWindow: 60000,      // 1 Minute Zeitfenster
maxMessagesPerWindow: 100,    // Max 100 Nachrichten pro Minute

// Status abfragen
const status = validator.getRateLimitStatus();
console.log(`Messages in window: ${status.messagesInWindow}`);
console.log(`Time until next: ${status.timeUntilNextMessage}ms`);
```

### Input Sanitization

Bereinigt potenziell schädliche Eingaben:

- **Dateipfade**: Entfernung von Path Traversal (../../../etc/passwd)
- **Strings**: Entfernung von Control Characters
- **JSON**: Safe Parsing und Re-Serialization

### Security Logging

Protokolliert alle Sicherheitsereignisse:

```typescript
// Wird im "Webview Security" Output Channel protokolliert
[2024-01-01T12:00:00.000Z] [WARNING] Rate limit exceeded: {
  "timeUntilNext": 15000,
  "messageCount": 101
}
```

## Integration im WebviewMessageHandler

Der WebviewMessageHandler wurde erweitert, um das Validation Framework zu verwenden:

```typescript
async handleMessage(data: WebviewMessage, webview: vscode.WebviewView): Promise<void> {
  try {
    // 1. Nachricht validieren
    const validation = this.messageValidator.validateInboundMessage(data);
    
    if (!validation.isValid) {
      // 2. Fehler anzeigen und abbrechen
      this.messageValidator.showValidationErrors(validation.errors);
      return;
    }
    
    // 3. Warnungen anzeigen (nicht-blockierend)
    if (validation.warnings.length > 0) {
      this.messageValidator.showValidationWarnings(validation.warnings);
    }
    
    // 4. Bereinigte Daten verwenden
    const messageData = validation.sanitizedData || data;
    
    // 5. Nachricht verarbeiten
    await this.processValidatedMessage(messageData, webview);
    
  } catch (error) {
    // Fehlerbehandlung
    console.error('[WebviewMessageHandler] Error handling message:', error);
    webview.webview.postMessage({
      type: 'error',
      message: 'An error occurred while processing your message.'
    });
  }
}
```

## Tests

Das Framework enthält umfassende Tests:

```bash
# Tests ausführen
npm test -- MessageValidator.test.ts

# Abdeckung prüfen
npm run test:coverage
```

### Test-Kategorien

- **Basic Validation**: Grundlegende Strukturvalidierung
- **Rate Limiting**: Funktion des Rate Limiters
- **Message Size**: Größenbeschränkungen
- **Schema Validation**: Nachrichtenspezifische Validierung
- **Input Sanitization**: Bereinigungsfunktionen
- **Type Guards**: Typ-Validierungsfunktionen
- **Error Handling**: Fehlerbehandlung

## Konfiguration

Das Validation Framework kann konfiguriert werden:

```typescript
interface ValidationConfig {
  enableRateLimit: boolean;      // Rate Limiting aktivieren
  maxMessageSize: number;        // Maximale Nachrichtengröße in Bytes
  rateLimitWindow: number;       // Zeitfenster in Millisekunden
  maxMessagesPerWindow: number;  // Max Nachrichten pro Zeitfenster
  enableSanitization: boolean;   // Input Sanitization aktivieren
  enableSecurityLogging: boolean;  // Security Logging aktivieren
}
```

## Best Practices

1. **Immer validieren**: Keine Nachricht ohne Validierung verarbeiten
2. **Sanitization nutzen**: Bereinigte Daten verwenden, nicht die Originaldaten
3. **Fehler behandeln**: Validation-Fehler freundlich anzeigen
4. **Logs überwachen**: Security Output Channel regelmäßig prüfen
5. **Konfiguration anpassen**: Limits an die Anwendung anpassen

## Erweiterbarkeit

Das Framework kann leicht erweitert werden:

### Neue Nachrichtentypen hinzufügen:

```typescript
// In MessageValidator.ts
const MessageSchemas: Record<string, any> = {
  // Bestehende Schemas...
  
  'newMessageType': {
    required: ['field1', 'field2'],
    fields: {
      field1: { type: 'string', maxLength: 100 },
      field2: { type: 'number', min: 0, max: 100 }
    }
  }
};
```

### Neue Sanitizer hinzufügen:

```typescript
// In InputSanitizer Klasse
sanitizeCustomField(value: string): string {
  // Eigene Bereinigungslogik
  return this.sanitizeString(value, 500);
}
```

### Neue Type Guards hinzufügen:

```typescript
// In TypeGuards Klasse
static isValidCustomType(value: any): boolean {
  return value && typeof value.customProperty === 'string';
}
