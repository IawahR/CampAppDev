# IAWAH Scheduler - End-to-End Testing Guide

## Test Environment Setup

### Prerequisites
- Google Apps Script project deployed
- Google Sheet with ID: `1LrhFpV77zQ3CdHgT9jJGcG5J29P7imNxgLhIcjBssnI`
- Sheets tabs: `AppData`, `Registrations` (auto-created on first registration save)
- Two user accounts available (can share same login)

### Test Credentials
- **Admin Account**: username: `admin`, password: `iawah`
- **Activity Signup Account**: username: `activitysignup`, password: `1956`

---

## Test Plan

### Phase 1: Authentication & Dashboard (15 min)

#### Test 1.1: Login Success
- [ ] Navigate to app
- [ ] Enter credentials: `activitysignup` / `1956`
- [ ] Verify login succeeds and dashboard appears
- [ ] Verify user pill shows "ACTIVITYSIGNUP"
- [ ] Verify only "Activity Scheduler" card is visible

#### Test 1.2: Login Failure
- [ ] Try invalid password
- [ ] Verify error toast: "Invalid credentials. Please try again."
- [ ] Try invalid username
- [ ] Verify error message appears

#### Test 1.3: Admin Login
- [ ] Logout (click Logout button)
- [ ] Login with: `admin` / `iawah`
- [ ] Verify dashboard displays with all cards
- [ ] Verify "Settings" card is visible (not available for activity-signup role)

#### Test 1.4: Logout
- [ ] Click "Logout" button
- [ ] Verify login screen reappears
- [ ] Verify form is cleared

---

### Phase 2: Year Persistence (10 min)

#### Test 2.1: Year Selection
- [ ] Login with `activitysignup` / `1956`
- [ ] Look for year selector (should be on main dashboard or in app header)
- [ ] Change year from 2026 to 2025
- [ ] Verify year updates in app state
- [ ] Logout

#### Test 2.2: Year Persistence
- [ ] Login again with same account
- [ ] Verify year is still 2025 (persisted in PropertiesService)
- [ ] Change back to 2026

---

### Phase 3: Activity Scheduler (20 min)

#### Test 3.1: Access Activity Scheduler
- [ ] Click "Activity Scheduler" card
- [ ] Verify week selector screen appears with 6 weeks listed (Week 1, 2, 3, 5, 6, 7)
- [ ] Verify counts show (e.g., "5 Sr · 3 Jr/JS")

#### Test 3.2: Load Week Data
- [ ] Click "Week 2"
- [ ] Wait for app shell to load
- [ ] Verify schedule grid appears
- [ ] Verify sync pill shows "Saved ✓"

#### Test 3.3: Add Camper with Validation
- [ ] Click "Activities" tab
- [ ] Scroll to "Senior/RISE Campers" section
- [ ] Click "+ Add Camper"
- [ ] Leave first name empty, enter last name
- [ ] Click "Save"
- [ ] Verify error toast: "firstName is required"
- [ ] Enter first name: "John"
- [ ] Enter last name: "Doe"
- [ ] Click "Save"
- [ ] Verify camper added to table
- [ ] Verify success toast or table update

#### Test 3.4: CSV Import with Quoted Fields
- [ ] Create test CSV with quoted fields:
  ```
  First Name,Last Name,Cabin,"Activity (with, comma)"
  "Smith, Jr","Alex","A1","Archery"
  "Jones","Blake","B2","Basketball"
  ```
- [ ] Click "Import Campers"
- [ ] Upload CSV
- [ ] Verify parser correctly handles "Smith, Jr" (not split on comma within quotes)
- [ ] Verify 2 campers imported

---

### Phase 4: Registration Module (20 min)

#### Test 4.1: Open Registration
- [ ] Click "Activity Scheduler" to go to hub screen (or use "Return to Dashboard")
- [ ] Look for "Registration" tab/button
- [ ] Click it
- [ ] Verify registration screen appears with empty table

#### Test 4.2: Add Registration
- [ ] Click "+ New Registration"
- [ ] Verify modal opens with title "New Registration"
- [ ] Leave first name empty, click "Save Registration"
- [ ] Verify error toast: "firstName is required"
- [ ] Fill form:
  - First Name: "Jane"
  - Last Name: "Smith"
  - Program: "Main Camp"
  - Week: "Week 1-3"
  - Cabin: "A1" (optional)
  - Status: "Pending"
  - Notes: "Test registration"
- [ ] Click "Save Registration"
- [ ] Verify success toast
- [ ] Verify registration appears in table with correct data

#### Test 4.3: Edit Registration
- [ ] In registration table, click "Edit" on newly added registration
- [ ] Verify modal opens with title "Edit Registration"
- [ ] Verify form is populated with existing data
- [ ] Change status to "Confirmed"
- [ ] Click "Save Registration"
- [ ] Verify success toast
- [ ] Verify table updates status to "Confirmed" (with green chip)

#### Test 4.4: Delete Registration
- [ ] Click "Delete" on the registration
- [ ] Verify confirmation: "Delete this registration? This cannot be undone."
- [ ] Click "OK"
- [ ] Verify registration removed from table
- [ ] Verify success toast

#### Test 4.5: Multiple Registrations
- [ ] Add 3+ more registrations with different programs
- [ ] Verify all appear in table
- [ ] Verify table is sortable/searchable (if implemented)

---

### Phase 5: Error Handling & Toast System (15 min)

#### Test 5.1: Toast Display
- [ ] Trigger various toasts throughout app:
  - Error toast (invalid form)
  - Success toast (save registration)
  - Info toast (if any)
- [ ] Verify correct styling:
  - Error: Red background, red icon (✕)
  - Success: Green background, green icon (✓)
  - Info: Blue background, blue icon (ℹ)

#### Test 5.2: Toast Auto-Dismiss
- [ ] Trigger any toast
- [ ] Verify it auto-dismisses after ~5 seconds
- [ ] No need for manual close

#### Test 5.3: Manual Close
- [ ] Trigger a toast
- [ ] Click the × button before auto-dismiss
- [ ] Verify toast closes immediately

#### Test 5.4: Multiple Toasts
- [ ] Trigger multiple toasts in quick succession
- [ ] Verify they stack vertically
- [ ] Verify each dismisses independently

#### Test 5.5: Network Error Handling
- [ ] Go offline (throttle network in DevTools to "Offline")
- [ ] Try to save a registration
- [ ] Verify error toast shows "Failed to save registration"
- [ ] Go back online
- [ ] Retry save
- [ ] Verify it succeeds

---

### Phase 6: Multi-User Sync (15 min)

#### Test 6.1: Concurrent Editing
- [ ] In Window 1: Login with `admin` / `iawah`
- [ ] In Window 2: Login with `activitysignup` / `1956` (different browser/incognito)
- [ ] In Window 1: Add a registration "User1 Test"
- [ ] In Window 2: Refresh or navigate away and back to Registration
- [ ] Verify "User1 Test" appears (real-time sync)

#### Test 6.2: Edit Collision
- [ ] In Window 1: Edit the registration, change status to "Completed"
- [ ] In Window 2: Edit the same registration, change cabin to "C1"
- [ ] Save in Window 1
- [ ] Save in Window 2
- [ ] Verify both changes are preserved (3-way merge)

---

### Phase 7: Permission-Based Access (10 min)

#### Test 7.1: Activity Signup Permissions
- [ ] Login with `activitysignup` / `1956`
- [ ] Verify only "Activity Scheduler" card is enabled
- [ ] Verify other cards are greyed out
- [ ] Try clicking "Staffing and Volunteers"
- [ ] Verify alert or disabled state

#### Test 7.2: Admin Permissions
- [ ] Login with `admin` / `iawah`
- [ ] Verify all cards are enabled
- [ ] Verify "Settings" card is visible
- [ ] Click "Settings"
- [ ] Verify settings screen appears

---

### Phase 8: Comprehensive Workflow (30 min)

#### Scenario: Complete Camp Week Setup
1. Login with `admin` / `iawah`
2. Click "Activity Scheduler"
3. Select "Week 2"
4. Add 5 activities (Archery, Basketball, Swimming, Arts & Crafts, Campfire)
5. Add 10 campers (mix of Senior and Jr)
6. Go to "Registration" tab
7. Add 3 registrations for Main Camp, 2 for YDLP
8. Go back to Activity Scheduler
9. Assign campers to activities
10. Verify schedule renders correctly
11. Logout and login as `activitysignup`
12. Verify you can see the schedule and registrations
13. Add a comment/note
14. Logout and login as `admin`
15. Verify changes from other user are visible

---

## Expected Outcomes

### ✅ All Tests Should Pass
- No JavaScript errors in browser console
- All toasts display correctly
- Real-time sync works between windows
- Validation prevents bad data
- CSV parser handles edge cases
- Authentication enforces permissions
- Data persists after logout/login

### ⚠️ Known Limitations
- Print functionality may need workaround (window.open disabled in some browsers)
- Year filtering not yet implemented (year selection saves but doesn't filter data)
- Settings admin panel placeholder only

---

## Debugging Tips

### Enable Console Logging
```javascript
// In browser console:
localStorage.setItem('debug', 'true');
// Check console for detailed logs
```

### Check PropertiesService Values
1. Go to Google Apps Script editor
2. Run: `PropertiesService.getUserProperties().getAll()`
3. Check for keys like `SELECTED_YEAR`, `ROLE_PERMISSIONS_*`

### View Sheet Data
- Open Google Sheet
- Check `AppData` tab for G, S data
- Check `Registrations` tab for all registrations

### Monitor Network
- Open DevTools → Network tab
- Watch google.script.run calls
- Check for success/failure handlers

---

## Sign-Off

**Tested By**: _________________  
**Date**: _________________  
**Overall Status**: ☐ PASS ☐ FAIL ☐ PARTIAL  
**Issues Found**: _________________  
**Ready for Production**: ☐ YES ☐ NO  
