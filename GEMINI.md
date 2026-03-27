# Gemini Codebase Guide: RoofReporterAI

This document provides a comprehensive overview of the RoofReporterAI codebase, architecture, and key features to assist Large Language Models in understanding and modifying the code.

## Project Overview

RoofReporterAI is a comprehensive business management CRM for roofing companies. It provides a suite of tools to help roofers manage their business, including generating roof measurement reports, sending invoices, and managing customer relationships. The platform is built as a modern, serverless web application with a strong focus on AI-powered features.

The application is available at [www.roofreporterai.com](https://www.roofreporterai.com).

## Core Technologies

*   **Backend Framework**: [Hono](https://hono.dev/) - A fast, lightweight, and modern web framework for serverless applications, running on Cloudflare Workers.
*   **Frontend**: The frontend is built using a server-side rendering (SSR) approach with Hono's JSX engine. It uses [Vite](https://vitejs.dev/) for the frontend build process. Static assets are served from the `/static` directory.
*   **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) - A serverless SQL database. The database schema is managed through migration files in the `migrations/` directory.
*   **Deployment**: [Cloudflare Pages](https://pages.cloudflare.com/) - The application is deployed as a Cloudflare Pages project, with the backend logic running on Cloudflare Workers.
*   **Payments**: [Square](https://developer.squareup.com/us/en) - Used for processing payments for roof reports and other services. The codebase also contains references to Stripe, suggesting a past or partial integration.
*   **Real-time Communication**: [LiveKit](https://livekit.io/) - The `livekit-agent/` directory and `livekit-server-sdk` dependency suggest the use of LiveKit for real-time features, likely related to the "Roofer Secretary" AI phone agent.
*   **Geospatial Data**: `geotiff` and `proj4` are used for processing geospatial data, likely from the Google Solar API.

## Architecture

The application follows a serverless architecture, leveraging the Cloudflare ecosystem.

*   **Entry Point**: The main application entry point is `src/index.tsx`. This file initializes the Hono application, sets up middleware (CORS, analytics), defines all the API routes, and serves the HTML pages.
*   **Routing**: The application has a large number of API routes defined under `/api`, organized by feature (e.g., `/api/reports`, `/api/crm`, `/api/orders`).
*   **Services**: The `src/services/` directory contains modules for interacting with external services like Google Cloud, Gemini, and the Google Solar API.
*   **Database Access**: The application interacts with the Cloudflare D1 database using the `c.env.DB` binding in the Hono context. Database queries are written in SQL.
*   **Server-Side Rendering**: HTML pages are rendered on the server using Hono's JSX engine. The `src/index.tsx` file contains numerous `get...HTML()` functions that generate the HTML for different pages.
*   **AI Components**: The application has several AI components, including a Python-based agent in the `livekit-agent/` directory, and integrations with various AI models and services.

## Key Features

*   **Roof Measurement Reports**: The core feature of the platform. The application uses the Google Solar API to get roof imagery and data, and then generates detailed measurement reports.
*   **CRM**: A full-featured CRM for roofing companies to manage their customers, jobs, and sales pipeline.
*   **Invoicing and Payments**: Customers can be invoiced, and payments can be collected through Square.
*   **AI Roofer Secretary**: An AI-powered phone answering service for roofers.
*   **Virtual Roof Try-On**: An AI feature that allows customers to visualize different roofing materials on their house.
*   **Team Management**: Roofing companies can manage their team members within the platform.
*   **D2D (Door-to-Door) Module**: A module for managing door-to-door sales.
*   **Analytics**: The platform has its own analytics and also integrates with Google Analytics 4.

## Database Schema

The database schema is defined in the `migrations/` directory. The initial schema (`0001_initial_schema.sql`) defines the following key tables:

*   `master_companies`: The businesses using the platform.
*   `customer_companies`: The customers of the `master_companies`.
*   `orders`: Roof measurement report orders.
*   `reports`: The generated roof measurement reports.
*   `payments`: Payment records.
*   `crm_...`: A set of tables for the CRM functionality (added in later migrations).

The migration history shows the addition of tables for features like the blog, AI secretary, chatbot, and more.

## AI Integrations

RoofReporterAI has a deep integration with various AI technologies:

*   **Google Solar API**: Used for getting roof data and imagery. Health checks for this API are available at `/api/health/solar`.
*   **Google Gemini**: The application uses the Gemini API for various tasks, including report enhancement. The Gemini health check is at `/api/health/gemini`.
*   **Cloudflare Workers AI**: The application is configured to use Cloudflare Workers AI for tasks like image classification and analysis.
*   **LiveKit Agent**: A Python-based AI agent is used for the "Roofer Secretary" feature, handling real-time phone conversations.
*   **HeyGen**: The `0034_heygen_videos.sql` migration suggests an integration with HeyGen for creating AI videos.
*   **Embeddings**: The `0030_report_search_embeddings.sql` migration suggests the use of embeddings for report search.

## Deployment

The application is deployed to Cloudflare Pages. The `wrangler.jsonc` file contains the configuration for the Cloudflare project. The `deploy` script in `package.json` shows the deployment process: `npm run build && wrangler pages deploy dist`. The `dist` directory is the build output.
