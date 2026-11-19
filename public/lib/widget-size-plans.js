// Reviewed design intent. Update alongside renderers; checked during smoke.
export const SIZE_PLANS = {
  benchmarks: {
    default:{size:'medium',reason:'One readable timing and correctness result invite people to inspect the measured workload.'},
    composition:'Medium leads with a measured latency. Wide separates latency from checks and sample context; distributions and methodology belong in fullscreen.',
    overflow:'Keep the main reading and correctness count whole. Bound supporting labels, and make all raw timing context and explanations accessible fullscreen.',
    variants:{medium:'One measured latency and a correctness summary',wide:'Latency beside correctness and sample context'}
  },
  "clock": {
    "default": {
      "size": "small",
      "reason": "Time is one dominant reading; the date and poem support it."
    },
    "composition": "World clocks add a comparison only in Wide.",
    "overflow": "Cap complete rows, keep controls reachable, and show an explicit remaining count. Titles may use an intentional line clamp; full content remains accessible on open.",
    "variants": {
      "small": "Time, date and the daily poem",
      "wide": "Time beside New York and London"
    }
  },
  "air-quality": {
    "default": {
      "size": "small",
      "reason": "AQI and its category are readable at a glance."
    },
    "composition": "Forecast history belongs in Wide; reference tables stay fullscreen.",
    "overflow": "Cap complete rows, keep controls reachable, and show an explicit remaining count. Titles may use an intentional line clamp; full content remains accessible on open.",
    "variants": {
      "small": "AQI and its category",
      "wide": "AQI beside the next six hours"
    }
  },
  "weather": {
    "default": {
      "size": "medium",
      "reason": "Now, the next sun event and a short forecast fit without shrinking the reading."
    },
    "composition": "Small is a current condition. Wide adds a horizontal time comparison. Do not fill extra space with unrelated metrics.",
    "overflow": "Cap complete rows, keep controls reachable, and show an explicit remaining count. Titles may use an intentional line clamp; full content remains accessible on open.",
    "variants": {
      "small": "Current temperature and next sun event",
      "medium": "Now and three upcoming hours",
      "wide": "Now beside a six-hour forecast"
    }
  },
  "daily": {
    "default": {
      "size": "medium",
      "reason": "Artwork and attribution need a useful viewing area."
    },
    "composition": "Tall favors the picture; Wide creates a museum label; Large adds the artwork story.",
    "overflow": "Cap complete rows, keep controls reachable, and show an explicit remaining count. Titles may use an intentional line clamp; full content remains accessible on open.",
    "variants": {
      "medium": "Whole painting with a quiet caption",
      "tall": "Portrait frame, artist and date",
      "wide": "Painting beside its museum label",
      "large": "Large artwork with its story"
    }
  },
  "hacker-news": {
    "default": {
      "size": "medium",
      "reason": "Three headlines form a short reading queue."
    },
    "composition": "Wider layouts can compare stories in columns; never crop a row or its controls.",
    "overflow": "Cap complete rows, keep controls reachable, and show an explicit remaining count. Titles may use an intentional line clamp; full content remains accessible on open.",
    "variants": {
      "small": "The leading headline",
      "medium": "Three readable headlines",
      "wide": "Four stories in two columns",
      "large": "Six stories with clear ranking"
    }
  },
  "sf-events": {
    "default": {
      "size": "medium",
      "reason": "A short agenda makes today’s options visible."
    },
    "composition": "Wide compares plans; Tall extends the agenda; details stay in the event view.",
    "overflow": "Cap complete rows, keep controls reachable, and show an explicit remaining count. Titles may use an intentional line clamp; full content remains accessible on open.",
    "variants": {
      "small": "One upcoming plan",
      "wide": "Three plans side by side",
      "tall": "A five-event agenda"
    }
  },
  "gardyn": {
    "default": {
      "size": "medium",
      "reason": "Growth stage and the existing plant timeline remain legible."
    },
    "composition": "Wide favors a chart; Large earns its space with the plant overview.",
    "overflow": "Cap complete rows, keep controls reachable, and show an explicit remaining count. Titles may use an intentional line clamp; full content remains accessible on open.",
    "variants": {
      "small": "Day and growth stage",
      "medium": "Ready crops, flowers and the next milestone",
      "wide": "The growth timeline, with room for every row",
      "large": "Every plant and its estimated stage"
    }
  },
  "fractal": {
    "default": {
      "size": "medium",
      "reason": "The artwork needs breathing room but no extra dashboard text."
    },
    "composition": "Tall and Large reframe the sculpture, not add decoration or extra render loops.",
    "overflow": "Cap complete rows, keep controls reachable, and show an explicit remaining count. Titles may use an intentional line clamp; full content remains accessible on open.",
    "variants": {
      "medium": "Floating art in a compact frame",
      "tall": "A taller frame for the whole sculpture",
      "large": "Room for the sculpture to breathe"
    }
  },
  "midterms": {
    "default": {
      "size": "medium",
      "reason": "The temporary authored election summary has one reviewed composition."
    },
    "composition": "No extra variants are justified for a short-lived card.",
    "overflow": "Cap complete rows, keep controls reachable, and show an explicit remaining count. Titles may use an intentional line clamp; full content remains accessible on open.",
    "variants": {}
  },
  "transit": {
    "default": {
      "size": "small",
      "reason": "Two upcoming departures answer when to leave."
    },
    "composition": "Medium adds stops; Wide uses horizontal comparison; Tall adds departures; Large can pair a route overview with predictions. Street interaction stays fullscreen.",
    "overflow": "Cap complete rows, keep controls reachable, and show an explicit remaining count. Titles may use an intentional line clamp; full content remains accessible on open.",
    "variants": {
      "medium": "Three departures and stop names",
      "large": "Six departures and provider freshness",
      "small": "The next two departures",
      "wide": "Three departures with stop names",
      "tall": "Five departures and provider freshness"
    }
  },
  "rss": {
    "default": {
      "size": "medium",
      "reason": "A headline and short excerpt invite reading without filling the wall."
    },
    "composition": "Small is one headline, Wide compares two, Tall provides a short reading queue, Large gives a source overview; Classic uses a four-story editorial spread, preferring distinct subscribed sources, with summaries and a source count.",
    "overflow": "Cap complete rows, keep controls reachable, and show an explicit remaining count. Titles may use an intentional line clamp; full content remains accessible on open.",
    "variants": {
      "small": "One headline and its source",
      "medium": "A headline with a short excerpt",
      "wide": "Two stories side by side",
      "tall": "Three headlines and their sources",
      "large": "Four stories from your sources"
    }
  },
  "todos": {
    "default": {
      "size": "medium",
      "reason": "Three short tasks and an honest remaining count fit without embedding setup instructions."
    },
    "composition": "Every row shows a bold assignee prefix beside its task. Classic Small shows two complete, actionable task rows and a remaining count; other themes retain their existing one-task composition; Wide separates next/upcoming; Tall is a longer checklist. Classic Medium and Tall empty states use a centered completion mark and a short message; task rows and completion controls remain intact when populated. Assignment pickers and setup instructions stay in fullscreen.",
    "overflow": "Cap complete rows, keep controls reachable, and show an explicit remaining count. Titles may use an intentional line clamp; full content remains accessible on open.",
    "variants": {
      "small": "Two tasks with completion controls and a remaining count",
      "medium": "Three tasks with completion controls",
      "wide": "Next task beside two upcoming tasks",
      "tall": "Five tasks in a calm checklist"
    }
  }
};
