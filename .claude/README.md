# Claude Code Configuration for Meme Perp DEX

This directory contains project-specific Claude Code configuration and custom skills.

## 📁 Structure

```
.claude/
├── README.md              # This file
└── skills/                # Custom skills for this project
    ├── meme-perp-commit/  # Smart git commit automation
    ├── meme-perp-test/    # Comprehensive test runner
    └── meme-perp-deploy/  # Deployment checklist & automation
```

## 🎯 Available Skills

### 1. meme-perp-commit
**Smart Git Commits**

Automatically creates semantic, well-structured commits following project conventions.

**When activated**: When you ask Claude to "commit", "save changes", or "create a commit"

**What it does**:
- Analyzes changed files
- Groups changes logically
- Creates semantic commits with proper scopes
- Includes Co-Authored-By attribution
- Follows conventional commits format

**Example triggers**:
- "Commit these changes"
- "Create a commit for the auth system"
- "Save my work"

---

### 2. meme-perp-test
**Comprehensive Test Suite**

Runs all tests for backend, contracts, and integration.

**When activated**: When you ask Claude to "test", "run tests", or "verify"

**What it does**:
- Runs backend module tests (auth, metadata, FOMO, relay)
- Executes contract tests with Foundry
- Validates wallet balances
- Provides detailed test results

**Test suites included**:
- `test-auth.ts` - Authentication system
- `test-token-metadata.ts` - Token metadata API
- `test-fomo.ts` - FOMO/Leaderboard
- `test-relay.ts` - Relay service
- `verify-derived-wallets.ts` - Wallet validation
- Contract tests via `forge test`

**Example triggers**:
- "Run all tests"
- "Test the auth module"
- "Verify everything works"

---

### 3. meme-perp-deploy
**Deployment Automation**

Complete deployment checklist and validation.

**When activated**: When you ask Claude to "deploy", "check deployment", or "production ready"

**What it does**:
- Validates environment variables
- Checks Redis connection
- Verifies contract deployment
- Runs pre-deploy tests
- Guides deployment process
- Post-deployment verification

**Deployment phases**:
1. Pre-deployment validation
2. Build & compile
3. Service deployment
4. Post-deployment checks

**Example triggers**:
- "Deploy to production"
- "Check if ready to deploy"
- "Verify deployment"

---

## 🚀 How to Use Skills

Claude will **automatically** use these skills when appropriate. You don't need to do anything special!

Just ask Claude naturally:
```
"Commit my changes"        → Uses meme-perp-commit
"Run the tests"            → Uses meme-perp-test
"Deploy to production"     → Uses meme-perp-deploy
```

---

## 🔧 Configuration

### Environment Variables

These skills expect the following environment variables:

**Required**:
- `SETTLEMENT_ADDRESS` - Settlement contract address
- `TOKEN_FACTORY_ADDRESS` - TokenFactory contract address
- `PRICE_FEED_ADDRESS` - PriceFeed contract address
- `MATCHER_PRIVATE_KEY` - Matcher wallet private key

**Optional**:
- `RELAYER_PRIVATE_KEY` - Relayer wallet private key (for gasless txs)
- `BASE_SEPOLIA_RPC` - RPC endpoint (defaults to https://sepolia.base.org)

### Dependencies

- **Bun**: JavaScript runtime for backend tests
- **Foundry**: Solidity testing framework
- **Redis**: Required for matching engine
- **Cast**: Foundry CLI tool for contract interactions

---

## 📝 Skill Development

Want to create more skills? Follow this structure:

```markdown
---
name: skill-name
description: When to use this skill
tools: Bash, Read, Grep, etc.
---

# Skill Title

Documentation here...

## When to Use
## Workflow
## Examples
## Best Practices
```

Save as: `.claude/skills/skill-name/SKILL.md`

---

## 🎓 Learning More

- [Claude Code Documentation](https://docs.anthropic.com/claude-code)
- [Skills Guide](https://docs.anthropic.com/claude-code/skills)
- [Custom Skills Tutorial](https://docs.anthropic.com/claude-code/custom-skills)

---

## 📊 Skill Usage Examples

### Example 1: After Implementing Auth
```
You: "I just finished implementing the auth system. Commit these changes."

Claude: [Uses meme-perp-commit skill]
- Analyzes changed files
- Creates commit: "feat(auth): implement authentication system"
- Includes proper commit message with details
- Adds Co-Authored-By attribution
```

### Example 2: Before Deploying
```
You: "Are we ready to deploy?"

Claude: [Uses meme-perp-deploy skill]
- Checks environment variables
- Verifies Redis connection
- Validates contract addresses
- Runs critical tests
- Provides deployment checklist
```

### Example 3: Regular Testing
```
You: "Test everything"

Claude: [Uses meme-perp-test skill]
- Runs test-auth.ts
- Runs test-token-metadata.ts
- Runs test-fomo.ts
- Runs test-relay.ts
- Verifies wallet balances
- Provides test summary
```

---

## ⚙️ Troubleshooting

### Skills Not Activating?

1. **Check file structure**: Ensure `SKILL.md` files exist in correct locations
2. **Restart Claude Code**: Skills are loaded on startup
3. **Check skill descriptions**: Make sure your request matches the description

### Skills Conflict?

If multiple skills match your request, Claude will choose the most specific one based on context.

---

## 🔄 Updates

Last updated: 2026-02-01

Changes:
- ✅ Created meme-perp-commit skill
- ✅ Created meme-perp-test skill
- ✅ Created meme-perp-deploy skill

---

**Happy coding! 🚀**
