"""
Sentry crash reporting initialisation.

Call initialise_sentry_error_reporting() once at startup from main.py,
only when SENTRY_DSN is present in the environment. The FastAPI
integration is auto-enabled by sentry-sdk when FastAPI is installed —
no explicit SentryAsgiMiddleware or integration list is needed.
"""

import sentry_sdk


def initialise_sentry_error_reporting(
    sentry_dsn: str,
    app_environment: str,
    app_version: str,
) -> None:
    """
    Initialises Sentry SDK for the FastAPI backend.

    The FastAPI integration is auto-enabled when FastAPI is installed —
    no explicit integration needed. Only call this if SENTRY_DSN is set
    in the environment.
    """
    sentry_sdk.init(
        dsn=sentry_dsn,
        environment=app_environment,              # "beta" or "production"
        release=f"orbit-backend@{app_version}",
        traces_sample_rate=0.2,                   # capture 20% of transactions — 100% would be too noisy in production
        send_default_pii=False,                   # never send PII — Orbit privacy rule, non-negotiable
        enable_logs=True,                         # structured log capture alongside errors
        profile_session_sample_rate=1.0,          # profile every sampled transaction
        profile_lifecycle="trace",                # profiler runs automatically on active transactions
    )
