# Security Policy

## Supported version

Security fixes are applied to the latest version on `main`.

## Current dependency note

This project is a browser-only SPA built with `createBrowserRouter`. It does not use React Router's unstable RSC APIs, SSR or Server Actions. `GHSA-qwww-vcr4-c8h2` applies only to unstable RSC APIs; reassess this boundary before adding those capabilities, and upgrade when the announced patched release becomes available on npm.

## Reporting a vulnerability

Do not disclose vulnerabilities, credentials, personal data or production URLs in a public issue.

Use GitHub Private Vulnerability Reporting for this repository. Include the affected component, reproduction steps, expected impact and any suggested mitigation. Reports containing working credentials should identify the credential type without pasting the credential itself.

## Deployment responsibilities

This repository does not contain production credentials. Operators are responsible for:

- storing Supabase service keys, OpenAI keys and internal secrets in server-side environment variables;
- enabling and reviewing Supabase RLS before exposing the Data API;
- restricting public sign-up and model usage;
- publishing privacy, retention and deletion rules before collecting real questionnaire data;
- rotating any credential that may have been exposed.
