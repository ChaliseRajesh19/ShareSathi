import pandas as pd
from pathlib import Path

folder = Path("docs/Data")
files = sorted(folder.glob("*.csv"))

previous_data = None
duplicates = []

for file in files:
    try:
        df = pd.read_csv(file, dtype=str, keep_default_na=False)

        # Ignore serial number and compare market data only
        data = df.iloc[:, 1:].reset_index(drop=True)

        if previous_data is not None and data.equals(previous_data[1]):
            duplicates.append((previous_data[0], file.name))

        previous_data = (file.name, data)

    except Exception as e:
        print(f"Could not read {file.name}: {e}")

print("Consecutive files with identical market data:", len(duplicates))
for earlier, later in duplicates[:20]:
    print(earlier, "->", later)
