# SBC Simplified Installer Tasks

> Execution checklist. Tasks derived from approved SPEC and PLAN.

**Spec:** ./SPEC.md (APPROVED)
**Plan:** ./PLAN.md (APPROVED)
**Status:** ✅ COMPLETE (2026-02-25)

---

## Pre-Implementation

- [x] SPEC.md reviewed and approved
- [x] PLAN.md reviewed and approved
- [x] All open questions from SPEC resolved
- [x] All blockers from PLAN cleared
- [x] Feature branch created: `feature/sbc-simplified-installer`

---

## Implementation

### Task 1: Add SBC Auth Key Validator

**File:** `cli/lib/validators.js`

- [x] Add `validateSbcAuthKey(key)` function
- [x] Validate non-empty, alphanumeric + dashes allowed
- [x] Export from module

### Task 2: Create setupSBC() Function

**File:** `cli/lib/commands/setup.js`

- [x] Create new `setupSBC(config)` async function
- [x] Display pre-requisite info box about manual SBC provisioning
- [x] Prompt for 3CX FQDN with validateHostname
- [x] Prompt for SBC Auth Key ID with validateSbcAuthKey
- [x] Set `config.sip.domain` = FQDN
- [x] Set `config.sip.registrar` = 127.0.0.1 (local SBC — drachtio registers with local SBC, not cloud)
- [x] Set `config.sip.sbcAuthKey` = Auth Key
- [x] Return updated config

### Task 3: Update Pi Setup Flow

**File:** `cli/lib/commands/setup.js`

- [x] In `setupPi()`, replace `setupSIP(config)` call with `setupSBC(config)`
- [x] Update step header from "☎️ SIP Configuration" to "📡 3CX SBC Connection"
- [x] Reorder: SBC (step 1) now runs before API Keys (step 2) per AC9
- [x] Ensure Mac `setupStandard()` still uses `setupSIP()` (unchanged)

### Task 4: Update .env Generation

**File:** `cli/lib/docker.js`

- [x] In `generateEnvFile()`, ensure SIP_DOMAIN and SIP_REGISTRAR use config.sip.domain
- [x] Add comment about SBC_AUTH_KEY for reference (not used by voice-app)
- [x] Verify port 5070 logic still works when SBC detected

### Task 5: Update Final Summary

**File:** `cli/lib/commands/setup.js`

- [x] Update Pi setup completion message
- [x] Add reminder about manual SBC provisioning in 3CX admin
- [x] Include link to 3CX SBC docs

---

## Verification

### Acceptance Criteria Checklist

- [x] AC1: Setup asks for 3CX FQDN
- [x] AC2: Setup asks for SBC Auth Key ID
- [x] AC3: Setup does NOT ask for "registrar IP"
- [x] AC4: Auto-detects 3CX SBC on port 5060
- [x] AC5: Uses port 5070 if SBC detected
- [x] AC6: .env has SIP_DOMAIN and SIP_REGISTRAR (registrar=127.0.0.1 for local SBC)
- [x] AC7: .env includes SBC_AUTH_KEY reference comment
- [x] AC8: Pre-requisites message displayed
- [x] AC9: Step 1 is "3CX SBC Connection"
- [x] AC10-12: Steps 2-4 unchanged
- [x] AC13: Final summary includes SBC reminder
- [x] AC14: FQDN validation works (validateHostname)
- [x] AC15: Auth Key validation works (validateSbcAuthKey)
- [x] AC16: Graceful fallback on port detection failure (existing logic)
- [x] AC17: Existing configs continue to work
- [x] AC18: SBC mode uses local registrar (127.0.0.1)

### Code Quality

- [x] No linter errors (`npm run lint`)
- [x] No new dependencies added
- [x] Code style matches existing patterns

---

## Manual Testing

- [ ] Run `claude-phone setup` on Pi
- [ ] Verify new TUI flow (SBC → API → Device → Mac)
- [ ] Run `claude-phone start` on Pi
- [ ] Make test call to extension
- [ ] Verify call connects and AI responds

---

## Documentation

- [x] Code comments for new functions

---

## Ready for Review

- [x] Self-review complete
- [ ] Ready for `/feature ship`

---

## Notes

[To be filled during implementation]
