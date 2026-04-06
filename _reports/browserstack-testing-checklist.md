# BrowserStack Testing Checklist

URL: https://lostbeard.github.io/v8-atomics-wait-bug/
Action: Click "Run All Tests" — copy the Results Summary table

---

## 1. Safari 18 / macOS Sequoia -- DONE

```
AFFECTED — 10.8% stale reads

TEST    WORKERS    BARRIER    STALE READS    ERROR RATE    RESULT
2W wait-notify    2    wait/notify    0 / 200,000    0.0%    PASS
3W wait/notify    3    wait/notify    1,625 / 15,000    10.8%    FAIL
3W spin    3    spin    0 / 18,000    0.0%    PASS
```

---

## 2. Safari 17 / macOS Sonoma

```
Results Summary

TEST	WORKERS	BARRIER	STALE READS	ERROR RATE	RESULT
2W wait-notify	2	wait/notify	0 / 200,000	0.0%	PASS
3W wait/notify	3	wait/notify	1,526 / 3,000	50.9%	FAIL
3W spin	3	spin	0 / 9,000	0.0%	PASS
```

---

## 3. Safari iOS 18 / iPhone 16 (ARM — watch if 2W test also fails)

```
Results Summary

TEST	WORKERS	BARRIER	STALE READS	ERROR RATE	RESULT
2W wait-notify	2	wait/notify	0 / 200,000	0.0%	PASS
3W wait/notify	3	wait/notify	638 / 3,000	21.3%	FAIL
3W spin	3	spin	0 / 9,000	0.0%	PASS
```

---

## 4. Safari iOS 16 / iPhone 14 (ARM)

```
Results Summary

TEST	WORKERS	BARRIER	STALE READS	ERROR RATE	RESULT
2W wait-notify	2	wait/notify	0 / 200,000	0.0%	PASS
3W wait/notify	3	wait/notify	634 / 3,000	21.1%	FAIL
3W spin	3	spin	0 / 9,000	0.0%	PASS
```

---

## 5. Edge latest (146) / Windows 11

```
Results Summary

TEST	WORKERS	BARRIER	STALE READS	ERROR RATE	RESULT
2W wait-notify	2	wait/notify	0 / 200,000	0.0%	PASS
3W wait/notify	3	wait/notify	846 / 3,000	28.2%	FAIL
3W spin	3	spin	0 / 9,000	0.0%	PASS
```

---

## 6. Edge latest (146) / macOS Tahoe

```
Results Summary (I tested 10 times and all tests passed every time!!!)

TEST	WORKERS	BARRIER	STALE READS	ERROR RATE	RESULT
2W wait-notify	2	wait/notify	0 / 200,000	0.0%	PASS
3W wait/notify	3	wait/notify	0 / 1,143,000	0.0%	PASS
3W spin	3	spin	0 / 900,000	0.0%	PASS
```

---

## 7. Safari latest (26) / macOS Tahoe

```
Results Summary (I tested 10 times and all tests passed every time)

TEST	WORKERS	BARRIER	STALE READS	ERROR RATE	RESULT
2W wait-notify	2	wait/notify	0 / 200,000	0.0%	PASS
3W wait/notify	3	wait/notify	784 / 3,000	26.1%	FAIL
3W spin	3	spin	0 / 9,000	0.0%	PASS
```

---

## 8. Firefox 149 / macOS Tahoe

```
Environment: SpiderMonkey (Firefox 149) | COI: Yes | Cores: 10

TEST	WORKERS	BARRIER	STALE READS	ERROR RATE	RESULT
2W wait-notify	2	wait/notify	0 / 200,000	0.0%	PASS
3W wait/notify	3	wait/notify	4,004 / 39,000	10.3%	FAIL
3W spin	3	spin	0 / 36,000	0.0%	PASS
```
---

## 9. Chrome 146 / macOS Tahoe

```
Environment: V8 (Chrome 146) | COI: Yes | Cores: 10

TEST	WORKERS	BARRIER	STALE READS	ERROR RATE	RESULT
2W wait-notify	2	wait/notify	0 / 200,000	0.0%	PASS
3W wait/notify	3	wait/notify	0 / 1,143,000	0.0%	PASS
3W spin	3	spin	0 / 900,000	0.0%	PASS
```

## 10. Opera (Chrome 145) / macOS Tahoe

```
Environment: V8 (Chrome 145) | COI: Yes | Cores: 10

TEST	WORKERS	BARRIER	STALE READS	ERROR RATE	RESULT
2W wait-notify	2	wait/notify	0 / 200,000	0.0%	PASS
3W wait/notify	3	wait/notify	0 / 1,143,000	0.0%	PASS
3W spin	3	spin	0 / 900,000	0.0%	PASS
```

## 11. Opera 129 (Chrome 145) / Windows 11

```
Environment: V8 (Chrome 145) | COI: Yes | Cores: 4

TEST	WORKERS	BARRIER	STALE READS	ERROR RATE	RESULT
2W wait-notify	2	wait/notify	0 / 200,000	0.0%	PASS
3W wait/notify	3	wait/notify	10,206 / 87,000	11.7%	FAIL
3W spin	3	spin	0 / 72,000	0.0%	PASS
```

## 12. Chrome / Android Google Pixel Pro 10 XL 

```
TEST	WORKERS	BARRIER	STALE READS	ERROR RATE	RESULT
2W wait-notify	2	wait/notify	14,501 / 100,000	14.5%	FAIL
3W wait/notify	3	wait/notify	21,712 / 231,000	9.4%	FAIL
3W spin	3	spin	0 / 144,000	0.0%	PASS
```

## 13. Chrome / Android Samsung Galaxy S26

```
TEST	WORKERS	BARRIER	STALE READS	ERROR RATE	RESULT
2W wait-notify	2	wait/notify	48,409 / 100,000	48.4%	FAIL
3W wait/notify	3	wait/notify	2,849 / 39,000	7.3%	FAIL
3W spin	3	spin	0 / 36,000	0.0%	PASS

```

## 14. Chrome / Android Huawei P30

```
> Huawei P30 - 9 is currently unavailable due to heavy traffic. Please try again later.
```