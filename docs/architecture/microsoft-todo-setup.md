# Microsoft To Do App Registration & PKCE Setup

Amethyst integrates with Microsoft To Do and Microsoft Graph via **OAuth 2.0 with Proof Key for Code Exchange (PKCE)** configured as a **Public Client**.

No client secret is required or stored anywhere in the application.

---

## 1. Create App Registration in Azure Portal

1. Log in to the [Microsoft Entra / Azure Portal](https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps).
2. Navigate to **Microsoft Entra ID** > **App registrations** > **New registration**.
3. Fill in the basic registration details:
   - **Name**: `Amethyst` (or your preferred name).
   - **Supported account types**: Select **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)**. This allows standard personal Microsoft accounts and work/school accounts to sign in.
   - **Redirect URI (optional)**:
     - Platform: **Web** (or **Mobile and desktop applications**).
     - Redirect URI: `http://localhost:8000/api/auth/microsoft/callback`
4. Click **Register**.

---

## 2. Configure Authentication (Public Client & Redirect URI)

1. Under the app's sidebar, click **Authentication**.
2. Under **Platform configurations**, verify or add `http://localhost:8000/api/auth/microsoft/callback`.
3. Scroll down to **Advanced settings** > **Allow public client flows**.
4. Set **Enable the following mobile and desktop flows** to **Yes**.
5. Click **Save**.

> **Important**: Do NOT create a Client Secret under "Certificates & secrets". Public client flows use cryptographically generated S256 code verifiers and challenges, ensuring zero leaked secrets.

---

## 3. Configure API Permissions

1. Under the app's sidebar, click **API permissions**.
2. Click **Add a permission** > **Microsoft Graph** > **Delegated permissions**.
3. Search and select:
   - `Tasks.ReadWrite` (read and write user tasks and task lists)
   - `offline_access` (receive refresh tokens for background sync)
   - `User.Read` (sign-in and read user profile)
4. Click **Add permissions**.

---

## 4. Configure Amethyst Environment

1. On your app's **Overview** page, copy the **Application (client) ID** (a UUID such as `d3590ed6-52b3-4102-aeff-aad2292ab01c`).
2. Add the client ID to your `.env` file or export it:
   ```bash
   MICROSOFT_TODO_CLIENT_ID="<your-application-client-id>"
   ```

---

## 5. Security & Token Vaulting

- Authorization happens via local PKCE challenge exchange (`code_challenge_method=S256`).
- Upon authorization, tokens (`access_token`, `refresh_token`, expiration) are stored directly in Amethyst's encrypted OS vault under the reference `amethyst/microsoft-todo.tokens`.
- Tokens are automatically refreshed using the refresh token when close to expiry.
