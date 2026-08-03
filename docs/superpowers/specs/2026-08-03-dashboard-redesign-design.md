# Barking Riverside Dashboard: Executive Accountability Redesign

## Objective
Redesign the Barking Riverside Train Tracker dashboard to focus on executive accountability and strict performance tracking (0-minute tolerance) for a director-level audience. The goal is to provide diagnostic data that highlights the severity and root causes of poor service (cancellations and delays).

## Architecture & Data Flow Updates
1. **Schema Update**: Add `cancel_reason` and `delay_reason` columns to the `scheduled_services` table.
2. **Poller Update**: Update the background poller to extract and store cancellation and delay reasons from the upstream data source (RTT).

## UI/UX Design

### Aesthetics & Theme
- Premium, professional Dark Mode utilizing glassmorphism and crisp typography.
- Analytical RAG (Red/Amber/Green) coloring, with an emphasis on alerting colors for failures to quickly draw executive attention.

### Section 1: Executive KPIs (Top Section)
1. **Strict On-Time Performance**: Percentage of trains arriving/departing with exactly 0 minutes of delay.
2. **Top Failure Reasons**: The single most frequent official reason for delays and cancellations.
3. **Delay Origin (Upstream vs. Turnaround)**: Breakdown of delays imported from outside the station versus delays generated locally during turnaround.
4. **Failure by Direction**: Breakdown of cancellations and severe delays split by arriving vs. departing services.

### Section 2: Deep-Dive & Diagnostic Widgets
1. **Failure Reasons Breakdown**: A visual chart (bar or donut) aggregating and displaying all cancellation and delay reasons over the selected time period.
2. **Peak vs. Off-Peak Accountability**: A chart comparing 0-minute tolerance performance during AM/PM peaks versus off-peak hours to identify resource misalignment during rush hours.
3. **Incident Log**: An interactive, sortable, and filterable table listing every delayed (>0 mins) and cancelled train.
   - **Columns**: Date, Scheduled Time, Direction, Actual Delay Minutes, Official Reason.

## Implementation Phases
1. **Database & Poller**: Apply migrations for reason columns; update poller logic.
2. **Backend/API**: Update frontend queries to fetch reasons and apply 0-minute tolerance logic.
3. **Frontend**: Implement the new Dark Mode theme, updated KPI tiles, Failure Reasons chart, and Incident Log table.
