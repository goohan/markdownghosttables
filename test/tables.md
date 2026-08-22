# Manual test tables

Scratch fixtures to eyeball the extension (ghost alignment, column colors, compact/expand, Tab). Edit freely — this file ships nowhere.

**Aligned/Expanded table:**

| Column A | Column B | Column C |
| -------- | -------- | -------- |
| A1       | B1       | C1       |
| A2       |          | C2       |
| A3       | B3       | C3       |

**Compacted table 1:**

| Column A | Column  B | |
| --- | --- | --- |
| A1 | B1 | |
| A2 | B2 | |

**Compacted table 2 (right alignment column):**

| Column A | Column  B | Column C | |
| --- | --: | --- | --- |
| A1 | B | | |
| A2 | B2 | | |
| A3 | B3 | | |

# Anchors and blocks test

====1====2====3====4====5====6====
   ‾‾‾      ‾‾‾  ‾‾‾‾     ‾‾‾‾  ‾‾‾‾      ‾‾‾‾

==1 ==2 ==3 ==4 ==5 ==6 ==
 ‾‾‾     ‾‾‾ ‾‾‾‾    ‾‾‾‾ ‾‾‾‾     ‾‾‾‾

== 1 == 2 == 3 == 4 == 5 == 6 ==
  ‾‾‾      ‾‾‾  ‾‾‾‾     ‾‾‾‾  ‾‾‾‾      ‾‾‾‾

---
