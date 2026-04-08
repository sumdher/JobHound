"""
Analytics service — optimized SQL aggregations for the dashboard.
Uses raw SQL via SQLAlchemy text() for performance, avoiding ORM overhead.
All queries filter by user_id and exclude soft-deleted applications.
"""

import uuid
from datetime import date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def get_overview_stats(user_id: uuid.UUID, db: AsyncSession) -> dict:
    """Return high-level stat cards for the dashboard."""
    sql = text("""
        SELECT
            COUNT(*) AS total_applications,
            COUNT(*) FILTER (
                WHERE status NOT IN ('rejected', 'ghosted', 'withdrawn')
            ) AS active_applications,
            COUNT(*) FILTER (
                WHERE status != 'applied'
            ) AS responded_count,
            ROUND(
                100.0 * COUNT(*) FILTER (WHERE status != 'applied')
                / NULLIF(COUNT(*), 0), 1
            ) AS response_rate_percent,
            ROUND(AVG(salary_min) FILTER (WHERE salary_min IS NOT NULL) / 100.0) AS avg_salary_min,
            COUNT(*) FILTER (
                WHERE date_applied >= date_trunc('month', CURRENT_DATE)
            ) AS applications_this_month
        FROM applications
        WHERE user_id = :user_id AND is_deleted = false
    """)
    result = await db.execute(sql, {"user_id": str(user_id)})
    row = result.mappings().one()

    # Most common skill
    skill_sql = text("""
        SELECT s.name
        FROM skills s
        JOIN application_skills aps ON aps.skill_id = s.id
        JOIN applications a ON a.id = aps.application_id
        WHERE a.user_id = :user_id AND a.is_deleted = false
        GROUP BY s.name
        ORDER BY COUNT(*) DESC
        LIMIT 1
    """)
    skill_result = await db.execute(skill_sql, {"user_id": str(user_id)})
    skill_row = skill_result.fetchone()
    most_common_skill = skill_row[0] if skill_row else None

    return {
        "total_applications": row["total_applications"],
        "active_applications": row["active_applications"],
        "response_rate_percent": float(row["response_rate_percent"] or 0),
        "avg_salary_min": float(row["avg_salary_min"] or 0),
        "most_common_skill": most_common_skill,
        "applications_this_month": row["applications_this_month"],
    }


async def get_applications_over_time(
    user_id: uuid.UUID, db: AsyncSession, period: str = "monthly"
) -> list[dict]:
    """Return application count grouped by week or month."""
    if period == "weekly":
        trunc = "week"
        fmt = "YYYY-WW"
    else:
        trunc = "month"
        fmt = "YYYY-MM"

    sql = text(f"""
        SELECT
            to_char(date_trunc('{trunc}', date_applied), '{fmt}') AS period,
            COUNT(*) AS count
        FROM applications
        WHERE user_id = :user_id AND is_deleted = false
          AND date_applied >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY 1
        ORDER BY 1
    """)
    result = await db.execute(sql, {"user_id": str(user_id)})
    return [{"period": r[0], "count": r[1]} for r in result.fetchall()]


async def get_status_funnel(user_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    """Return count of applications per status for the funnel chart."""
    sql = text("""
        SELECT status, COUNT(*) AS count
        FROM applications
        WHERE user_id = :user_id AND is_deleted = false
        GROUP BY status
        ORDER BY count DESC
    """)
    result = await db.execute(sql, {"user_id": str(user_id)})
    return [{"status": r[0], "count": r[1]} for r in result.fetchall()]


async def get_skills_frequency(
    user_id: uuid.UUID, db: AsyncSession, limit: int = 20
) -> list[dict]:
    """Return top N skills by usage count for the current user."""
    sql = text("""
        SELECT s.name, s.category, COUNT(*) AS count
        FROM skills s
        JOIN application_skills aps ON aps.skill_id = s.id
        JOIN applications a ON a.id = aps.application_id
        WHERE a.user_id = :user_id AND a.is_deleted = false
        GROUP BY s.name, s.category
        ORDER BY count DESC
        LIMIT :limit
    """)
    result = await db.execute(sql, {"user_id": str(user_id), "limit": limit})
    return [{"name": r[0], "category": r[1], "count": r[2]} for r in result.fetchall()]


async def get_source_effectiveness(user_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    """Return per-source application counts and response rates."""
    sql = text("""
        SELECT
            COALESCE(source, 'unknown') AS source,
            COUNT(*) AS applied_count,
            COUNT(*) FILTER (
                WHERE status NOT IN ('applied', 'ghosted')
            ) AS response_count,
            ROUND(
                100.0 * COUNT(*) FILTER (WHERE status NOT IN ('applied', 'ghosted'))
                / NULLIF(COUNT(*), 0), 1
            ) AS response_rate
        FROM applications
        WHERE user_id = :user_id AND is_deleted = false
        GROUP BY source
        ORDER BY applied_count DESC
    """)
    result = await db.execute(sql, {"user_id": str(user_id)})
    return [
        {
            "source": r[0],
            "applied_count": r[1],
            "response_count": r[2],
            "response_rate": float(r[3] or 0),
        }
        for r in result.fetchall()
    ]


async def get_salary_distribution(user_id: uuid.UUID, db: AsyncSession) -> dict:
    """Return salary histogram buckets plus median/p25/p75 percentiles."""
    sql = text("""
        WITH salaries AS (
            SELECT salary_min / 100 AS salary_eur
            FROM applications
            WHERE user_id = :user_id AND is_deleted = false
              AND salary_min IS NOT NULL AND salary_currency = 'EUR'
        ),
        stats AS (
            SELECT
                percentile_cont(0.25) WITHIN GROUP (ORDER BY salary_eur) AS p25,
                percentile_cont(0.50) WITHIN GROUP (ORDER BY salary_eur) AS median,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY salary_eur) AS p75,
                MIN(salary_eur) AS min_val,
                MAX(salary_eur) AS max_val
            FROM salaries
        ),
        buckets AS (
            SELECT
                width_bucket(salary_eur, min_val, max_val + 1, 10) AS bucket,
                COUNT(*) AS count
            FROM salaries, stats
            GROUP BY bucket
            ORDER BY bucket
        )
        SELECT
            bucket,
            count,
            (stats.min_val + (bucket - 1) * (stats.max_val - stats.min_val + 1) / 10) AS bucket_min,
            (stats.min_val + bucket * (stats.max_val - stats.min_val + 1) / 10) AS bucket_max,
            stats.p25,
            stats.median,
            stats.p75
        FROM buckets, stats
    """)
    result = await db.execute(sql, {"user_id": str(user_id)})
    rows = result.fetchall()

    buckets = [
        {"bucket_min": int(r[2] or 0), "bucket_max": int(r[3] or 0), "count": r[1]}
        for r in rows
    ]
    p25 = float(rows[0][4]) if rows else 0
    median = float(rows[0][5]) if rows else 0
    p75 = float(rows[0][6]) if rows else 0

    return {"buckets": buckets, "p25": p25, "median": median, "p75": p75}


async def get_response_time(user_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    """Return average days from application to first response, by source."""
    sql = text("""
        SELECT
            COALESCE(source, 'unknown') AS source,
            ROUND(AVG(
                EXTRACT(EPOCH FROM (status_updated_at - created_at)) / 86400.0
            )::numeric, 1) AS avg_days
        FROM applications
        WHERE user_id = :user_id
          AND is_deleted = false
          AND status_updated_at IS NOT NULL
          AND status != 'applied'
        GROUP BY source
        ORDER BY avg_days
    """)
    result = await db.execute(sql, {"user_id": str(user_id)})
    return [{"source": r[0], "avg_days": float(r[1] or 0)} for r in result.fetchall()]


async def get_status_by_month(user_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    """Return application counts by status per month for the past 12 months."""
    sql = text("""
        SELECT
            to_char(date_trunc('month', date_applied), 'YYYY-MM') AS month,
            status,
            COUNT(*) AS count
        FROM applications
        WHERE user_id = :user_id
          AND is_deleted = false
          AND date_applied >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY 1, 2
        ORDER BY 1, 2
    """)
    result = await db.execute(sql, {"user_id": str(user_id)})
    return [{"month": r[0], "status": r[1], "count": r[2]} for r in result.fetchall()]
