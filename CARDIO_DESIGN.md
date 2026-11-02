# Cardio: requirements and design discussion

Status: implemented for the local-only 4.3 review branch. The user currently has no wearable and uses Apple Fitness. The web app provides manual measurements and optional manual daily Fitness totals. Native HealthKit import remains future work and is not claimed as part of this release. A used-watch purchase is a separate decision, pending budget and iPhone compatibility.

## User intent
Cardio is separate from strength training but integrated into the same history and fitness picture. It can be a standalone session or a finisher linked to a lifting session. A separate completed session can also be logged while an unfinished lifting workout remains open, without discarding or attaching to it. Include jogging around the block, walking the dogs, treadmill and stair climber. Show useful long-term performance changes and consider an optional watch/phone fitness-data integration. Do not invent a VO2 max estimate from inadequate inputs. A wearable may be a later phase; don't make one a prerequisite for basic logging.

## Implemented data and views
- A Cardio area to log activities and view weekly activity volume and matched performance trends. Cardio-only sessions must not advance the A/B/C lifting rotation.
- Record activity/mode, date/time, duration and optional distance, units, effort and average heart rate. Machine entries may include speed, incline, level, floors, and machine identity. Source and measurement units must be explicit. Missing heart rate stays missing.
- Optional link from a cardio session to its lifting session. Count the cardio once; distinguish a fresh session from a post-lifting finisher in comparisons.
- Dog walks and general steps contribute to activity volume. Compare running/walking benchmarks on comparable routes and conditions; distinguish stop/start leisure walks from sustained efforts.
- Treadmill trends should match speed/incline and stair-climber trends should match machine/settings. Machine levels/calorie estimates are not interchangeable across models.
- Keep three distinct views: activity volume (steps/minutes), performance benchmarks (pace/workload at comparable effort/heart rate), and explicitly sourced device VO2 max estimates if available. These are related but not equivalent metrics.
- Preserve historical timed bike/stair entries. Any later projection or migration into Cardio must use stable identities and avoid duplicating the original entries or daily steps. Backup, restore, exports and user-initiated ChatGPT sharing must include cardio.

## Integration boundary
The iPhone already records steps and walking/running distances in Apple Health. LiftLog's Safari/Home Screen web app has no direct HealthKit access. Automatic Health reads require an authorized native iPhone component with the HealthKit capability; no cloud synchronization or OpenAI API is necessary for that on-device path. Do not promise that GitHub Pages alone can read Health data or reliably monitor workouts/steps in the background.

Apple Watch can produce a VO2 max estimate from qualifying outdoor walking, running or hiking. Do not treat treadmill or stair-climber logs as direct Apple VO2 max measurements. Preserve source, date, units and the fact that it is an estimate. A missing estimate is not zero. Repeated benchmark results can show performance trends without creating a VO2 number.

Implementation: cardio is projected from completed timed Cardio sets in `history`, preserving the same session/item/set identities for finishers and standalone sessions. Optional measurement objects live on those sets, and `activityDays` contains one manually entered Fitness total per date. Repeated blocks are aggregated within the same workout for comparisons. Sources, context, route/machine labels and entered operating settings form comparison groups; missing HR is not treated as zero. Cardio minutes never count as lifting volume. No automatic imports, step estimation or VO2 calculation is performed.

Primary references checked:
- https://support.apple.com/en-us/104997 — iPhone Health step and distance collection.
- https://support.apple.com/en-us/108790 — Apple Watch cardio-fitness estimates.
- https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/vo2max — supported VO2 max source workouts.
- https://developer.apple.com/documentation/healthkit/setting-up-healthkit — native capability and permissions.
