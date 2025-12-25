# Connection Retry Logic Implementation

**Date**: 2025-12-25
**Related**: v1.1.0 - Resiliência e Observabilidade

## Objective

Implement automatic connection retry with exponential backoff for the drizzle-multitenant package.

## Context

### Starting Point
- Package at v1.0.8 with 193 tests
- Retry types already existed in `types.ts` but were not implemented

### Why This Work
- Connections can fail temporarily due to network issues, database restarts, or resource limits
- Users need automatic retry with configurable backoff to improve resilience

## Key Decisions

### Decision 1: Async Methods vs Modifying Sync Methods

**Question**: Should we modify `getDb()` to be async or add new async methods?

| Option | Description |
|--------|-------------|
| A | Modify `getDb()` to be async (breaking change) |
| B | Add new `getDbAsync()` alongside existing sync method |

**Decision**: Option B - Add new async methods

**Rationale**:
- Maintains backward compatibility
- Users can opt-in to retry behavior
- Sync version still useful for simple cases

### Decision 2: Retry Implementation Location

**Question**: Where should retry logic live?

| Option | Description |
|--------|-------------|
| A | Inline in pool.ts |
| B | Separate retry.ts module with reusable utilities |

**Decision**: Option B - Separate module

**Rationale**:
- Reusable for custom operations (`withRetry`, `createRetrier`)
- Testable in isolation
- Clean separation of concerns

## Implementation Summary

### 1. `retry.ts` module

Core retry logic with:
- `withRetry()` - Async operation wrapper with configurable retry
- `createRetrier()` - Factory for reusable retry config
- `isRetryableError()` - Detects transient connection errors
- `calculateDelay()` - Exponential backoff with jitter

### 2. Pool manager updates

New async methods:
- `getDbAsync(tenantId)` - Creates pool with retry and ping validation
- `getSharedDbAsync()` - Same for shared database
- `getRetryConfig()` - Returns current retry configuration

### 3. Debug logging

New events:
- `connection_retry` - Logged on each retry attempt
- `CONNECTION_SUCCESS` - Logged when connection succeeds after retries

## Usage Example

```typescript
// Configuration
defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
    retry: {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      jitter: true,
      onRetry: (attempt, error, delay) => {
        console.log(`Retry ${attempt}: ${error.message}`)
      },
    },
  },
});

// Usage with retry
const db = await tenants.getDbAsync('tenant-123');
```

## Technical Deep Dive

### Exponential Backoff with Jitter

```typescript
function calculateDelay(attempt, config) {
  // Exponential: initialDelay * (multiplier ^ attempt)
  const exponentialDelay = config.initialDelayMs
    * Math.pow(config.backoffMultiplier, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter (0-25% random) to prevent thundering herd
  if (config.jitter) {
    return Math.floor(cappedDelay * (1 + Math.random() * 0.25));
  }
  return Math.floor(cappedDelay);
}
```

### Retryable Errors Detection

```typescript
function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Connection errors
  if (message.includes('econnrefused')) return true;
  if (message.includes('etimedout')) return true;

  // PostgreSQL transient
  if (message.includes('too many connections')) return true;
  if (message.includes('database system is starting up')) return true;

  return false;
}
```

### Pending Connection Deduplication

The pool manager uses a `pendingConnections` map to avoid creating duplicate connection attempts:

```typescript
private readonly pendingConnections: Map<string, Promise<PoolEntry>> = new Map();

async getDbAsync(tenantId: string) {
  // Check if already connecting
  const pending = this.pendingConnections.get(schemaName);
  if (pending) {
    return (await pending).db;  // Wait for existing attempt
  }

  // Start new connection with retry
  const promise = this.connectWithRetry(tenantId, schemaName);
  this.pendingConnections.set(schemaName, promise);
  // ...
}
```

## Files Modified

### New Files
| File | Description |
|------|-------------|
| `src/retry.ts` | Retry logic with exponential backoff |
| `src/retry.test.ts` | 20 unit tests |

### Modified Files
| File | Changes |
|------|---------|
| `src/types.ts` | Added `connection_retry` to DebugContext type |
| `src/pool.ts` | Added async methods and retry integration |
| `src/manager.ts` | Exposed new async methods |
| `src/debug.ts` | Added retry logging functions |
| `src/config.ts` | Added retry config validation |
| `src/index.ts` | Exported retry utilities and types |

## Learnings

### Vitest Fake Timers with Rejected Promises

Testing retry logic with fake timers and rejected promises can cause unhandled rejection warnings. Solution: use real timers for rejection tests with minimal delays.

### Interface Updates Propagate to Manager

When adding methods to `TenantManager` interface, must also update `manager.ts` to implement them.

## Related

- Commit: `bf149bd` feat(retry): implement automatic connection retry with exponential backoff
- See [Advanced Guide](/guide/advanced) for usage documentation
