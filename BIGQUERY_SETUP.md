# BigQuery Setup Guide for Self-Hosted Codebuff

If you want to enable logging of chat messages, token usage, and agent execution traces to Google BigQuery in your self-hosted instance, follow these steps.

## Prerequisites

- A Google Cloud Platform (GCP) project.
- Billing enabled on the GCP project.

## Step 1: Create a Service Account

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Navigate to **IAM & Admin** > **Service Accounts**.
3.  Click **Create Service Account**.
4.  Give it a name (e.g., `codebuff-logger`).
5.  Grant it the following roles:
    - **BigQuery User**
    - **BigQuery Data Editor**
6.  Click **Done**.
7.  Click on the newly created service account, go to the **Keys** tab.
8.  Click **Add Key** > **Create new key** > **JSON**.
9.  Save the downloaded JSON file to your server (e.g., `/etc/codebuff/service-account.json`).

## Step 2: Enable BigQuery API

1.  Go to **APIs & Services** > **Library**.
2.  Search for "BigQuery API".
3.  Click **Enable**.

## Step 3: Configure Environment Variables

Update your `.env.local` or environment configuration with the following:

```bash
# Path to the JSON key file you downloaded
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# (Optional) Custom dataset name. Defaults to 'codebuff_data_dev' in non-prod.
BIGQUERY_DATASET=my_custom_dataset
```

## Step 4: Verification

Restart your Codebuff instance. On the first request (e.g., sending a chat message), the system will automatically:
1.  Connect to BigQuery using the credentials.
2.  Create the dataset (`codebuff_data_dev` or your custom name) if it doesn't exist.
3.  Create the required tables (`traces`, `relabels`, `message`) if they don't exist.

If configuration is missing or incorrect, you will see error logs, but the application will continue to function (logging will be skipped).
