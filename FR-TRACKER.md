# Functional Requirements Tracker

> Generated from **CS3219: Project Milestone 1 (D1), Project Group 4**.
>
> **Tracking convention:** check an item only when that exact
> requirement has been completed. Requirement IDs and wording below
> follow the proposal as written.
>
> **Source-ID notes:** The proposal contains `F.15.1` (with an extra
> period) and two separate requirements labelled `F21.1`. These are
> preserved below and flagged because duplicate/inconsistent IDs should
> be resolved before using FR IDs for automated issue tracking.

## User Service

### F1 --- Account Registration

-   [ ] **F1** --- Account Registration. The system shall allow an
    eligible user to register for a User account. --- **Priority:** High
    · **Sprint:** 7
    -   [ ] **F1.1** --- The system shall allow a user to submit a
        username, valid NUS email address, and password as part of the
        registration request. --- **Priority:** High · **Sprint:** 7
    -   [ ] **F1.2** --- The system shall reject a registration request
        when the username, email address, or password is missing or
        contains only whitespace. --- **Priority:** High · **Sprint:** 7
    -   [ ] **F1.3** --- The system shall verify that the submitted
        username satisfies the agreed username format and length
        constraints. --- **Priority:** High · **Sprint:** 7
    -   [ ] **F1.4** --- The system shall verify that the submitted
        email address follows the agreed valid email format. ---
        **Priority:** High · **Sprint:** 7
    -   [ ] **F1.5** --- The system shall require verification of the
        submitted email address before the registered account is
        activated. --- **Priority:** Medium · **Sprint:** 9
    -   [ ] **F1.6** --- The system shall reject verification attempts
        that are invalid, expired, or already used. --- **Priority:**
        Medium · **Sprint:** 9
    -   [ ] **F1.7** --- The system shall prevent accounts that have not
        completed email verification from accessing protected platform
        functions. --- **Priority:** Medium · **Sprint:** 9
    -   [ ] **F1.8** --- The system shall verify that the submitted
        password satisfies the agreed password policy. --- **Priority:**
        High · **Sprint:** 7
    -   [ ] **F1.9** --- The system shall reject registration when the
        submitted username is already associated with an existing
        account. --- **Priority:** High · **Sprint:** 7
    -   [ ] **F1.10** --- The system shall reject registration when the
        submitted email address is already associated with an existing
        account. --- **Priority:** High · **Sprint:** 7
    -   [ ] **F1.11** --- The system shall not create duplicate accounts
        when the same registration request is submitted repeatedly. ---
        **Priority:** High · **Sprint:** 7
    -   [ ] **F1.12** --- After successful registration, the system
        shall create a User account and return a unique account
        identifier and the account's initial state. --- **Priority:**
        High · **Sprint:** 7

### F2 --- User Authentication

-   [ ] **F2** --- User authentication. The system shall authenticate
    registered accounts before allowing access to protected platform
    functions. --- **Priority:** High · **Sprint:** 7
    -   [ ] **F2.1** --- The system shall allow a registered account to
        log in using its registered username and password. ---
        **Priority:** High · **Sprint:** 7
    -   [ ] **F2.2** --- The system shall create an authenticated
        session only when the submitted credentials match an active
        registered account. --- **Priority:** High · **Sprint:** 7
    -   [ ] **F2.3** --- The system shall reject a login attempt when
        the submitted username or password does not match a registered
        account. --- **Priority:** High · **Sprint:** 7
    -   [ ] **F2.4** --- The system shall not create an authenticated
        session after an unsuccessful login attempt. --- **Priority:**
        High · **Sprint:** 7

### F3 --- Session Management

-   [ ] **F3** --- Session management. The system shall manage
    authenticated sessions for registered accounts. --- **Priority:**
    Medium · **Sprint:** 9
    -   [ ] **F3.1** --- The system shall allow an authenticated account
        to maintain access to the platform during an active session. ---
        **Priority:** Medium · **Sprint:** 9
    -   [ ] **F3.2** --- The system shall allow an authenticated account
        to log out of the platform. --- **Priority:** Medium ·
        **Sprint:** 9
    -   [ ] **F3.3** --- The system shall invalidate the account's
        active session after logout. --- **Priority:** Medium ·
        **Sprint:** 9
    -   [ ] **F3.4** --- The system shall reject requests to protected
        operations when no valid authenticated session is supplied. ---
        **Priority:** Medium · **Sprint:** 9
    -   [ ] **F3.5** --- The system shall require the account to
        authenticate again after an authenticated session is
        invalidated. --- **Priority:** Medium · **Sprint:** 9

### F4 --- User Participation

-   [ ] **F4** --- User participation. The system shall allow
    authenticated accounts with User privileges to participate in the
    platform as both a Requester or Courier using the same account. ---
    **Priority:** High · **Sprint:** 7
    -   [ ] **F4.1** --- The system shall allow an authenticated account
        with User privileges to perform Requester actions using the same
        registered account. --- **Priority:** High · **Sprint:** 7
    -   [ ] **F4.2** --- The system shall allow an authenticated account
        with User privileges to perform Courier actions using the same
        registered account. --- **Priority:** High · **Sprint:** 7

### F5 --- Account and Privilege Management

-   [ ] **F5** --- Account and Privilege Management. The system shall
    maintain each account's account type and the privileges associated
    with that account type. --- **Priority:** High · **Sprint:** 7
    -   [ ] **F5.1** --- Each account shall have an account type field.
        --- **Priority:** High · **Sprint:** 7
    -   [ ] **F5.2** --- The account type field shall support the
        following account types: User and Admin and Superadmin. ---
        **Priority:** High · **Sprint:** 7
    -   [ ] **F5.3** --- The system shall assign the User account type
        to accounts created through normal account registration. ---
        **Priority:** High · **Sprint:** 7
    -   [ ] **F5.4** --- The system shall assign the Admin account type
        only through an authorized administrative process. ---
        **Priority:** High · **Sprint:** 7
    -   [ ] **F5.5** --- The system shall assign the Superadmin account
        type only through an authorised administrative process. ---
        **Priority:** High · **Sprint:** 7
    -   [ ] **F5.6** --- An Admin account shall have all privileges
        available to a User account, in addition to Admin privileges.
        --- **Priority:** High · **Sprint:** 7
    -   [ ] **F5.7** --- A Superadmin account shall have all privileges
        available to an Admin account, in addition to Superadmin
        privileges. --- **Priority:** Medium · **Sprint:** 9
    -   [ ] **F5.8** --- The system shall allow a Superadmin to create
        and view Admin accounts. --- **Priority:** Medium · **Sprint:**
        9
    -   [ ] **F5.9** --- The system shall allow a Superadmin to update
        Admin accounts, including revoking their Admin privileges. ---
        **Priority:** Medium · **Sprint:** 9
    -   [ ] **F5.10** --- The system shall allow a Superadmin to
        deactivate User and Admin accounts. --- **Priority:** Medium ·
        **Sprint:** 9

## Supplier Service

### F6 --- Supplier CRUD

-   [ ] **F6** --- The system should support CRUD operations on campus
    suppliers/facilities/locations. --- **Priority:** High · **Sprint:**
    7
    -   [ ] **F6.1** --- Each supplier record will have its name,
        category, campus building as mandatory fields, and also store
        the timestamp of the last modification and if the supplier is
        still active. Optional fields include a description of the
        location, geographical coordinates, starting time, closing time,
        and an image of the supplier. --- **Priority:** High ·
        **Sprint:** 7
        -   [ ] **F6.1.1** --- The category should be restricted to a
            fixed set of values to keep filtering and display
            consistent. --- **Priority:** High · **Sprint:** 7
    -   [ ] **F6.2** --- The system should support the creation,
        reading, updating and deletion of supplier records by accounts
        with Admin privileges. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F6.2.1** --- Creation of a supplier record inserts the
            record into the database, uniquely identified by a
            combination of its name, building and active status. ---
            **Priority:** High · **Sprint:** 7
        -   [ ] **F6.2.2** --- The administrative user should be able to
            view the supplier listing (including soft-deleted records)
            through the same listing/search endpoint used by requesters
            and couriers (FR7). --- **Priority:** High · **Sprint:** 7
        -   [ ] **F6.2.3** --- Updating a supplier record should allow
            for partial updates of only one or a few fields for that
            record in the database. --- **Priority:** High · **Sprint:**
            7
        -   [ ] **F6.2.4** --- Deletion operation will flag the record
            as inactive instead of a hard removal from the database,
            such that existing or past requests can still reference that
            supplier. --- **Priority:** High · **Sprint:** 7
    -   [ ] **F6.3** --- The system should validate the CRUD operation
        before executing it, and return a clear, appropriate error
        response for failed CRUD operations. --- **Priority:** High ·
        **Sprint:** 7
        -   [ ] **F6.3.1** --- Validation errors (missing/invalid
            fields) should be returned with field-level detail. ---
            **Priority:** High · **Sprint:** 7
        -   [ ] **F6.3.2** --- Inserting a duplicate supplier record
            should return a "supplier already exists" error. ---
            **Priority:** High · **Sprint:** 7
        -   [ ] **F6.3.3** --- Operations on a non-existent or
            already-deleted supplier should return a "supplier not
            found" error. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F6.3.4** --- Unauthorized create/update/delete
            attempts should return a "forbidden/unauthorized" error. ---
            **Priority:** High · **Sprint:** 7
        -   [ ] **F6.3.5** --- Downstream/infrastructure failures
            (e.g. database unavailable) should return a generic server
            error without leaking internal details. --- **Priority:**
            High · **Sprint:** 7
        -   [ ] **F6.3.6** --- The system should check that each
            creation, update or deletion operation was not made later
            than the latest update timestamp for the supplier, and
            should return a "record has been modified, please try again"
            error. --- **Priority:** High · **Sprint:** 7

### F7 --- Supplier Listing, Search and Filtering

-   [ ] **F7** --- The system should provide a searchable and filterable
    listing of active suppliers/facilities/locations, viewable by
    requesters and couriers. --- **Priority:** High · **Sprint:** 7
    -   [ ] **F7.1** --- The system should be seeded with the template
        repository's initial supplier data, extended with additional
        entries. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F7.1.1** --- The seed data should load automatically
            on the first deployment of the application. ---
            **Priority:** High · **Sprint:** 7
        -   [ ] **F7.1.2** --- The seed data should be supplemented with
            additional entries to demonstrate a "rich listing" across
            supplier categories and campus locations. --- **Priority:**
            High · **Sprint:** 7
    -   [ ] **F7.2** --- The listing should support free-text search on
        the supplier name. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F7.2.1** --- The system should display a "no suppliers
            found" state when the search returns zero results. ---
            **Priority:** High · **Sprint:** 7
        -   [ ] **F7.2.2** --- The search should be case-insensitive and
            match on partial substrings. --- **Priority:** High ·
            **Sprint:** 7
        -   [ ] **F7.2.3** --- The search results should update
            dynamically as the user types, not requiring a manual search
            action. --- **Priority:** Medium · **Sprint:** 10
        -   [ ] **F7.2.4** --- The search should be combinable with
            existing filters (if any). --- **Priority:** Medium ·
            **Sprint:** 10
    -   [ ] **F7.3** --- Users should be able to filter suppliers by
        category and building (campus location). --- **Priority:** High
        · **Sprint:** 7
        -   [ ] **F7.3.1** --- Filtering should support the selection of
            multiple options. --- **Priority:** High · **Sprint:** 7

## Order Service

### F8 --- Errand Creation

-   [ ] **F8** --- The system should support the creation of an errand
    request. --- **Priority:** High · **Sprint:** 8
    -   [ ] **F8.1** --- The system will reserve a portion of the
        requester's credits equal to the standard errand credit cost on
        creation. --- **Priority:** High · **Sprint:** 8
        -   [ ] **F8.1.1** --- The system will reject the request
            creation if the requester credit amount is below the
            standard errand credit cost. --- **Priority:** High ·
            **Sprint:** 8
    -   [ ] **F8.2** --- The system should require the requester to
        specify the supplier, pickup location, dropoff location, errand
        cost and delivery notes before creating the errand. ---
        **Priority:** High · **Sprint:** 8
        -   [ ] **F8.2.1** --- Information on the requester, supplier,
            pickup location, dropoff location, errand cost and delivery
            notes are stored as errand fields.
    -   [ ] **F8.3** --- A newly created errand should be assigned the
        OPEN status. --- **Priority:** High · **Sprint:** 8
    -   [ ] **F8.4** --- The system will assign an expiry time to each
        newly created errand. --- **Priority:** Medium · **Sprint:** 10
    -   [ ] **F8.5** --- The system should check if the supplier is
        still active before creating the errand, in the edge case where
        the supplier is soft-deleted in the process of errand creation.
        If the supplier no longer exists, the errand creation should
        fail and the system should display a "supplier no longer exists"
        error. --- **Priority:** Medium · **Sprint:** 10
    -   [ ] **F8.6** --- On creation the errand will have a unique
        errand ID assigned to it. --- **Priority:** High · **Sprint:** 8

### F9 --- View and Filter Errands

-   [ ] **F9** --- The system should allow viewing and filtering errand
    requests. --- **Priority:** High · **Sprint:** 8
    -   [ ] **F9.1** --- Only OPEN status errand requests are displayed.
        --- **Priority:** High · **Sprint:** 8
    -   [ ] **F9.2** --- Relevant information for each errand request
        should be displayed such as pickup, drop-off locations, errand
        description, credit reward and time created along with time to
        expiry. --- **Priority:** High · **Sprint:** 8
    -   [ ] **F9.3** --- The system should allow filtering of open
        errand requests based on pickup, drop-off locations, keywords in
        the errand description and time created. --- **Priority:**
        Medium · **Sprint:** 8

### F10 --- Errand Acceptance

-   [ ] **F10** --- The system should allow couriers to accept errand
    requests. --- **Priority:** High · **Sprint:** 9
    -   [ ] **F10.1** --- Only OPEN status errand requests can be
        accepted. --- **Priority:** High · **Sprint:** 9
    -   [ ] **F10.2** --- The system should stop requesters from
        accepting their own errand request. --- **Priority:** Medium ·
        **Sprint:** 8
    -   [ ] **F10.3** --- The system should prevent more than one
        courier from accepting the same errand request. ---
        **Priority:** High · **Sprint:** 9
        -   [ ] **F10.3.1** --- The system should verify that the errand
            is still OPEN before allowing the courier to accept it. ---
            **Priority:** High · **Sprint:** 9
    -   [ ] **F10.4** --- After a courier accepts an errand the system
        should change the errand status to ACCEPTED. --- **Priority:**
        High · **Sprint:** 9
        -   [ ] **F10.4.1** --- An ACCEPTED errand is no longer
            available for acceptance by other couriers. ---
            **Priority:** High · **Sprint:** 9
    -   [ ] **F10.5** --- After successful acceptance the courier is
        assigned to the errand by the system. --- **Priority:** High ·
        **Sprint:** 9

### F11 --- Pickup

-   [ ] **F11** --- The system should allow couriers to indicate that
    the errand has been picked up and that the delivery has begun. ---
    **Priority:** High · **Sprint:** 9
    -   [ ] **F11.1** --- After the courier has indicated that the
        errand has been picked up the errand status should be changed to
        PICKED_UP. --- **Priority:** High · **Sprint:** 9
        -   [ ] **F11.1.1** --- Pickup confirmation is only allowed when
            the errand status is ACCEPTED. --- **Priority:** High ·
            **Sprint:** 9
    -   [ ] **F11.2** --- Only the courier assigned to the errand can
        indicate that the requested item has been picked up. ---
        **Priority:** High · **Sprint:** 9

### F12 --- Errand Completion

-   [ ] **F12** --- The system should mark an errand as completed after
    both requester and courier have confirmed delivery. ---
    **Priority:** High · **Sprint:** 9
    -   [ ] **F12.1** --- Errand status should have status changed to
        PENDING_COMPLETION after the courier indicates that the errand
        has been completed. --- **Priority:** High · **Sprint:** 9
        -   [ ] **F12.1.1** --- The system should only allow couriers to
            indicate completion when the errand is in PICKED_UP state.
            --- **Priority:** High · **Sprint:** 9
    -   [ ] **F12.2** --- Errand status should have status updated to
        from PENDING_COMPLETION to COMPLETED after the requester
        indicates the errand has been completed. --- **Priority:** High
        · **Sprint:** 9
        -   [ ] **F12.2.1** --- The system should only allow the
            requester to indicate completion when the errand is in a
            PENDING_COMPLETION state. --- **Priority:** High ·
            **Sprint:** 9
    -   [ ] **F12.3** --- The reserved amount of credits equal to the
        errand cost in the requester's account should be transferred to
        the courier after errand status is changed to COMPLETED. ---
        **Priority:** High · **Sprint:** 9
    -   [ ] **F12.4** --- The system should assign a confirmation
        deadline to an errand with the status PENDING_COMPLETION. ---
        **Priority:** Medium · **Sprint:** 9
        -   [ ] **F12.4.1** --- After the confirmation deadline, the
            system will change errand status from PENDING_COMPLETION to
            COMPLETED automatically. --- **Priority:** Medium ·
            **Sprint:** 9
        -   [ ] **F12.4.2** --- When an errand is automatically
            completed due to timeout, reserved credits will be
            transferred to the courier. --- **Priority:** Medium ·
            **Sprint:** 9
        -   [ ] **F12.4.3** --- The system will only allow the requester
            to confirm receipt before the confirmation deadline. ---
            **Priority:** Medium · **Sprint:** 9

### F13 --- Errand Cancellation

-   [ ] **F13** --- The system should allow users to cancel errands that
    have been created or accepted. --- **Priority:** Medium ·
    **Sprint:** 10
    -   [ ] **F13.1** --- Requesters should be able to cancel their own
        created requests. --- **Priority:** Medium · **Sprint:** 10
        -   [ ] **F13.1.1** --- Only OPEN status errands can be
            cancelled by their requester. --- **Priority:** Medium ·
            **Sprint:** 10
        -   [ ] **F13.1.2** --- Upon successful cancellation, errand
            status is updated to CANCELLED. --- **Priority:** Medium ·
            **Sprint:** 10
        -   [ ] **F13.1.3** --- Errands cancelled in this way should
            release reserved credits back to the requester. ---
            **Priority:** Medium · **Sprint:** 10
    -   [ ] **F13.2** --- Couriers should be able to cancel errand
        requests that they have accepted. --- **Priority:** Medium ·
        **Sprint:** 10
        -   [ ] **F13.2.1** --- A courier can only cancel an errand with
            the ACCEPTED status. --- **Priority:** Medium · **Sprint:**
            10
        -   [ ] **F13.2.2** --- Errand status should be updated from
            ACCEPTED to CANCELLED after the errand has been cancelled.
            --- **Priority:** Medium · **Sprint:** 10
        -   [ ] **F13.2.3** --- Errands cancelled this way should
            release reserved credits back to the requester. ---
            **Priority:** Medium · **Sprint:** 10

### F14 --- Errand Expiry

-   [ ] **F14** --- The system should remove errands from the viewing
    list after the acceptance expiry time has been reached while the
    errand status is OPEN. --- **Priority:** Medium · **Sprint:** 10
    -   [ ] **F14.1** --- On expiry, the system assigns the EXPIRED
        status to the errand. --- **Priority:** Medium · **Sprint:** 10
        -   [ ] **F14.1.1** --- EXPIRED errands cannot be accepted by
            couriers. --- **Priority:** Medium · **Sprint:** 10
    -   [ ] **F14.2** --- Reserved credits should be released on expiry.
        --- **Priority:** Medium · **Sprint:** 10

### F15 --- Retention of Terminal Errands

-   [ ] **F15** --- The system should retain all CANCELLED, EXPIRED and
    COMPLETED errand requests. --- **Priority:** Low · **Sprint:** 11
    -   [ ] **F.15.1** ⚠️ --- All errands with CANCELLED, EXPIRED, and
        COMPLETED statuses are removed from display and are not
        available for further processing. --- **Priority:** Low ·
        **Sprint:** 11
        -   **ID note:** The proposal writes this as `F.15.1`, rather
            than `F15.1`.

### F16 --- Errand Lifecycle States

-   [ ] **F16** --- The system should maintain well-defined statuses for
    each stage of an errand request lifecycle. --- **Priority:** High ·
    **Sprint:** 8
    -   [ ] **F16.1** --- The system should support the following errand
        states: OPEN, ACCEPTED, PICKED_UP, PENDING_COMPLETION,
        COMPLETED, CANCELLED, EXPIRED. --- **Priority:** High ·
        **Sprint:** 8
        -   [ ] **F16.1.1** --- The system should only allow the
            following valid status transitions: From OPEN: → ACCEPTED, →
            CANCELLED, → EXPIRED; From ACCEPTED: → PICKED_UP, →
            CANCELLED; From PICKED_UP: → PENDING_COMPLETION; From
            PENDING_COMPLETION: → COMPLETED. --- **Priority:** High ·
            **Sprint:** 8
        -   [ ] **F16.1.2** --- CANCELLED, EXPIRED and COMPLETED
            statuses are considered as terminal statuses and no further
            state transition are allowed once an errand reaches these
            states. --- **Priority:** High · **Sprint:** 8
        -   [ ] **F16.1.3** --- Any transition status not listed in
            F16.1.1 shall be rejected by the system, and the status
            should remain unchanged. --- **Priority:** High ·
            **Sprint:** 8

### F17 --- Errand Events

-   [ ] **F17** --- The system will generate public events whenever an
    errand reaches a terminal state. --- **Priority:** High ·
    **Sprint:** 8
    -   [ ] **F17.1** --- Errand terminal states are as specified in
        F16.1.2. --- **Priority:** High · **Sprint:** 8
    -   [ ] **F17.2** --- The system shall signify completion when
        errand status changes to COMPLETED. --- **Priority:** High ·
        **Sprint:** 8
        -   [ ] **F17.2.1** --- Signal will be sent when the requester
            confirms errand completion for their errand. (F12) ---
            **Priority:** High · **Sprint:** 8
        -   [ ] **F17.2.2** --- Signal will be sent when automatic
            timeout occurs for an errand in the PENDING_COMPLETION state
            (F12.4). --- **Priority:** Medium · **Sprint:** 10
    -   [ ] **F17.3** --- The system shall signify errand cancellation
        when errand status changes to CANCELLED. --- **Priority:**
        Medium · **Sprint:** 10
        -   [ ] **F17.3.1** --- Signal will be sent when the requester
            cancels their own errand. (F13.1) --- **Priority:** Medium ·
            **Sprint:** 10
        -   [ ] **F17.3.2** --- Signal will be sent when the courier
            cancels an errand they accepted. (F13.2) --- **Priority:**
            Medium · **Sprint:** 10
    -   [ ] **F17.4** --- The system shall signify errand expiry when
        errand status changes to EXPIRED. --- **Priority:** Medium ·
        **Sprint:** 10
        -   [ ] **F17.4.1** --- Signal will be sent when an errand with
            OPEN status passes its expiry duration. (FX.) ---
            **Priority:** Medium · **Sprint:** 10
    -   [ ] **F17.5** --- The system shall signify that the errand has
        been picked up when errand status changes to PICKED_UP. ---
        **Priority:** Medium · **Sprint:** 10
        -   [ ] **F17.5.1** --- Signal will be sent when a courier
            assigned to the request indicates that the item specified in
            the errand has been picked up. (FX.) --- **Priority:**
            Medium · **Sprint:** 10

## Credit Service

### F18 --- Reserve Credits

-   [ ] **F18** --- Credits equivalent to the errand's credit cost,
    should be reserved from the requester's account when an errand is
    created. --- **Priority:** High · **Sprint:** 8
    -   [ ] **F18.1** --- Requester's reserved balance should increase
        by the errand's credit cost. --- **Priority:** High ·
        **Sprint:** 8
    -   [ ] **F18.2** --- Requester's available balance should decrease
        by the errand's credit cost. --- **Priority:** High ·
        **Sprint:** 8
    -   [ ] **F18.3** --- Before transfer, credit service should check
        that the available balance is greater than or equal to the
        errand cost. --- **Priority:** High · **Sprint:** 8

### F19 --- Transfer Credits on Completion

-   [ ] **F19** --- Credits equivalent to the errand's credit cost,
    should be transferred to the courier's available balance, from the
    requester's reserved balance after the errand is completed. ---
    **Priority:** High · **Sprint:** 9
    -   [ ] **F19.1** --- After the transaction, the courier's available
        balance should increase by the errand's credit cost. ---
        **Priority:** High · **Sprint:** 9
    -   [ ] **F19.2** --- The credit service shall wait for the Order
        service to confirm the completion of an errand before
        transferring credits from requester's reserve balance to
        courier's available balance. --- **Priority:** High ·
        **Sprint:** 9

### F20 --- Refund Reserved Credits

-   [ ] **F20** --- Should an errand be cancelled for whatever reason
    (errand cancellation/Expiry), reserved credits should be refunded to
    the requester. --- **Priority:** High · **Sprint:** 9
    -   [ ] **F20.1** --- The requester's available balance should be
        increased by the errand's credit cost. --- **Priority:** High ·
        **Sprint:** 9
    -   [ ] **F20.2** --- The requester's reserve balance should
        decrease by the errand's credit cost. --- **Priority:** High ·
        **Sprint:** 9
    -   [ ] **F20.3** --- The courier's available balance should
        experience no change in value. --- **Priority:** High ·
        **Sprint:** 9
    -   [ ] **F20.4** --- The credit service shall wait for order
        service before releasing credits back to the requester. ---
        **Priority:** High · **Sprint:** 9

### F21 --- Closed Credit Economy

-   [ ] **F21** --- Credit service should maintain a closed economy,
    ensuring that all credit transfers and balances operate within set
    boundaries. --- **Priority:** High · **Sprint:** 8
    -   [ ] **F21.1** ⚠️ --- On user account creation, the user receives
        Y initial credits. --- **Priority:** High · **Sprint:** 8
    -   [ ] **F21.1** ⚠️ --- The total number of credits in the economy
        should remain proportional to the number of users. (Assuming X
        number of users with Y initial credits, total credits in system
        across all balances should always add up to X\*Y credits.) ---
        **Priority:** Med · **Sprint:** 8
    -   [ ] **F21.2** --- All credit balances (available and reserve)
        should always have a non-negative value. --- **Priority:** High
        · **Sprint:** 8

> ⚠️ **Duplicate ID:** The proposal contains two different requirements
> labelled `F21.1`. Give one a unique ID before enabling automatic FR
> completion.

### F22 --- Transaction Logging / Duplicate Transfer Prevention

-   [ ] **F22** --- Credit service should log all transactions to handle
    an edge case where multiple control signals from Order Service might
    be received telling Credit Service to transfer credits for the same
    errand. --- **Priority:** Med · **Sprint:** 9
    -   [ ] **F22.1** --- Credit service should log transactions with a
        primary key like (Errand ID, transaction type) to prevent
        duplicate logs. --- **Priority:** Med · **Sprint:** 9
    -   [ ] **F22.2** --- Credit service should log the transaction
        before performing the transfer transaction. --- **Priority:**
        Med · **Sprint:** 9
        -   [ ] **F22.2.1** --- Transfer should be blocked if logging
            fails (ie. there is a duplicate transfer query). ---
            **Priority:** Med · **Sprint:** 9
        -   [ ] **F22.2.2** --- Transfer should go through if logging
            succeeds (ie. unique transfer query). --- **Priority:** Med
            · **Sprint:** 9

## User Interface

### F23 --- Authentication Page

-   [ ] **F23** --- Authentication page should provide a toggle to
    switch between Sign-up and Login. --- **Priority:** High ·
    **Sprint:** 7
    -   [ ] **F23.1** --- Toggling to Login should display 2 fields
        "Username" and "Password". --- **Priority:** High · **Sprint:**
        7
    -   [ ] **F23.2** --- Toggling to Sign-up should introduce a new
        field "Email" for users to enter their email. --- **Priority:**
        High · **Sprint:** 7

### F24 --- Role-specific Homepage

-   [ ] **F24** --- Valid authentication should bring the user to their
    respective homepage. --- **Priority:** High · **Sprint:** 7
    -   [ ] **F24.1** --- Accounts with User privileges should be
        brought to the homepage where they can interact with the app.
        --- **Priority:** High · **Sprint:** 7
    -   [ ] **F24.2** --- Accounts with Admin privileges should be
        brought to the admin dashboard where they can additionally
        perform admin functions. --- **Priority:** Med · **Sprint:** 10
        -   [ ] **F24.2.1** --- Accounts with Admin privileges should be
            able to view user statistics: Total users, active users. ---
            **Priority:** Med · **Sprint:** 10
        -   [ ] **F24.2.2** --- Accounts with Admin privileges should be
            able to view supplier statistics: Total supplier, active
            supplier, deactivated supplier. --- **Priority:** Med ·
            **Sprint:** 10
        -   [ ] **F24.2.3** --- Accounts with Admin privileges should be
            able to add new suppliers. --- **Priority:** Med ·
            **Sprint:** 10
        -   [ ] **F24.2.4** --- Accounts with Admin privileges should be
            able to deactivate suppliers. --- **Priority:** Med ·
            **Sprint:** 10
        -   [ ] **F24.2.5** --- Accounts with Admin privileges should be
            able to edit supplier details. --- **Priority:** Med ·
            **Sprint:** 10
        -   [ ] **F24.2.6** --- Accounts with Admin privileges should be
            able to view errand statistics: Total errands, completed
            errands, expired errands, cancelled errands. ---
            **Priority:** Med · **Sprint:** 10
        -   [ ] **F24.2.7** --- Accounts with Admin privileges should be
            able to view Credit statistics: Total credits in system,
            transaction logs. --- **Priority:** Med · **Sprint:** 10
    -   [ ] **F24.3** --- Accounts with Superadmin privileges should
        additionally be able to access account administration functions.
        --- **Priority:** Med · **Sprint:** 10
        -   [ ] **F24.3.1** --- The account administration interface
            should display Admin accounts. --- **Priority:** Med ·
            **Sprint:** 10
        -   [ ] **F24.3.2** --- The account administration interface
            should provide controls for creating Admin accounts. ---
            **Priority:** Med · **Sprint:** 10
        -   [ ] **F24.3.3** --- The account administration interface
            should provide controls for promoting and demoting Admin
            accounts. --- **Priority:** Med · **Sprint:** 10
        -   [ ] **F24.3.4** --- The account administration interface
            should provide controls for deactivating User and Admin
            accounts. --- **Priority:** Med · **Sprint:** 10

### F25 --- User Homepage

-   [ ] **F25** --- User homepage should support both desktop and mobile
    view. --- **Priority:** Med · **Sprint:** 9
    -   [ ] **F25.1** --- Homepage should display desktop interactable
        elements. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F25.1.1** --- Homepage should display Supplier list.
            --- **Priority:** High · **Sprint:** 7
        -   [ ] **F25.1.2** --- Homepage should display Errand list. ---
            **Priority:** High · **Sprint:** 7
        -   [ ] **F25.1.3** --- Homepage should display Settings button.
            --- **Priority:** High · **Sprint:** 7
        -   [ ] **F25.1.4** --- Homepage should display active errand
            card if there are active errands tied to the user account.
            --- **Priority:** High · **Sprint:** 7
    -   [ ] **F25.2** --- Homepage should display mobile interactable
        elements. --- **Priority:** Med · **Sprint:** 9
        -   [ ] **F25.2.1** --- Homepage should by default display
            Supplier list. --- **Priority:** Med · **Sprint:** 9
        -   [ ] **F25.2.2** --- Homepage should display a list toggle
            that changes the display between supplier and errand list.
            --- **Priority:** Med · **Sprint:** 9
        -   [ ] **F25.2.3** --- Homepage should display Settings button.
            --- **Priority:** Med · **Sprint:** 9
        -   [ ] **F25.2.4** --- Homepage should display active errand
            card if there are active errands tied to the user account.
            --- **Priority:** Med · **Sprint:** 9

### F26 --- Errand Creation and Acceptance UI

-   [ ] **F26** --- User should be able to create an errand by
    interacting with supplier cards in the supplier list. ---
    **Priority:** High · **Sprint:** 7
    -   [ ] **F26.1** --- Supplier list should display each supplier as
        a individual supplier cards. --- **Priority:** High ·
        **Sprint:** 7
        -   [ ] **F26.1.1** --- Each supplier card should contain an
            icon/image representing the supplier. --- **Priority:** High
            · **Sprint:** 7
        -   [ ] **F26.1.2** --- Each supplier card should contain a
            brief description of the errand. --- **Priority:** High ·
            **Sprint:** 7
    -   [ ] **F26.2** --- Interacting with a supplier card should bring
        the user to an errand creation page. --- **Priority:** High ·
        **Sprint:** 7
        -   [ ] **F26.2.1** --- Errand creation page should display the
            non-intractable form of the supplier card. --- **Priority:**
            High · **Sprint:** 7
        -   [ ] **F26.2.2** --- Errand creation page should have a field
            for errand cost. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F26.2.3** --- Errand creation page should have a field
            for destination. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F26.2.4** --- Errand creation page should have a field
            for notes to courier. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F26.2.5** --- Errand creation page should have a
            cancel and confirm button. --- **Priority:** High ·
            **Sprint:** 7
        -   [ ] **F26.2.6** --- Errand creation should only be confirmed
            when confirm button is pressed. --- **Priority:** High ·
            **Sprint:** 7
    -   [ ] **F26.3** --- Errand list should display each errand
        requests as individual errand cards. --- **Priority:** High ·
        **Sprint:** 7
        -   [ ] **F26.3.1** --- Each errand card should contain the
            icon/image of the supplier (ie. pickup point). ---
            **Priority:** High · **Sprint:** 7
        -   [ ] **F26.3.2** --- Each errand card should contain a brief
            description of the errand. --- **Priority:** High ·
            **Sprint:** 7
    -   [ ] **F26.4** --- Interacting with an errand card should create
        and errand preview pop-up that display more information. ---
        **Priority:** High · **Sprint:** 7
        -   [ ] **F26.4.1** --- The pop-up should display the
            non-interactable form of the errand card. --- **Priority:**
            High · **Sprint:** 7
        -   [ ] **F26.4.2** --- The pop-up should display the errand
            reward (ie. cost). --- **Priority:** High · **Sprint:** 7
        -   [ ] **F26.4.3** --- The pop-up should display the
            destination. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F26.4.4** --- The pop-up should display any additional
            notes to courier. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F26.4.5** --- The pop-up should have a cancel and a
            accept button. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F26.4.6** --- Errand should only be reflected as
            accepted if accept button is pressed. --- **Priority:** High
            · **Sprint:** 7

### F27 --- Settings

-   [ ] **F27** --- User should be able to go to the settings page by
    pressing the settings button (F25.1.3 and F25.2.3). ---
    **Priority:** Low · **Sprint:** 10
    -   [ ] **F27.1** --- Settings button should display the user icon
        and username. --- **Priority:** Low · **Sprint:** 10
    -   [ ] **F27.2** --- Settings page should allow user to change
        their username. --- **Priority:** Low · **Sprint:** 10
    -   [ ] **F27.3** --- Settings page should allow user to request
        password reset email. --- **Priority:** Low · **Sprint:** 10
    -   [ ] **F27.4** --- Settings page should allow users to change
        their profile icon/picture. --- **Priority:** Low · **Sprint:**
        10
    -   [ ] **F27.5** --- Settings page should allow users to toggle
        location permissions (TBC). --- **Priority:** Low · **Sprint:**
        10
    -   [ ] **F27.6** --- Settings page should allow users to log out of
        their account. --- **Priority:** Low · **Sprint:** 10

### F28 --- Active Errand Status

-   [ ] **F28** --- User should be able to view all active errand
    statuses in greater detail by interacting with the active errand
    card (F25.1.4 and F25.2.4). --- **Priority:** High · **Sprint:** 7
    -   [ ] **F28.1** --- Active errand page should display a list of
        all active errands tagged to the user regardless of their role
        in the errand. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F28.1.1** --- Active errand page should display active
            errands created by user (User acts as requester). ---
            **Priority:** High · **Sprint:** 7
        -   [ ] **F28.1.2** --- Active errand page should display active
            errands accepted by user (User acts as courier). ---
            **Priority:** High · **Sprint:** 7
    -   [ ] **F28.2** --- Active errand page should display active
        errands as interactive errand cards with role-specific buttons.
        --- **Priority:** High · **Sprint:** 7
        -   [ ] **F28.2.1** --- All active errand cards should display a
            brief description of the errand. --- **Priority:** High ·
            **Sprint:** 7
        -   [ ] **F28.2.2** --- User should see errand preview pop-up
            similar to F26.4 when interacting with the errand card. ---
            **Priority:** High · **Sprint:** 7
        -   [ ] **F28.2.3** --- Requested errands (User created this
            errand) should display default icon if errand is not yet
            accepted. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F28.2.4** --- Requested errands (User created this
            errand) should display courier's user icon if errand is has
            been accepted. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F28.2.5** --- Requested errands (User created this
            errand) should display a cancel errand button and a mark
            completed button. The mark completed button allows requester
            to confirm completion of the errand and changes to errand
            state to COMPLETED. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F28.2.6** --- Courier errands (User accepted this
            errand) should display supplier icon if errand has yet to be
            picked up. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F28.2.7** --- Courier errands (User accepted this
            errand) should display requester's user icon if errand has
            been picked up. --- **Priority:** High · **Sprint:** 7
        -   [ ] **F28.2.8** --- Courier errands (User accepted this
            errand) should display a cancel errand button if the errand
            has not been picked up. --- **Priority:** High · **Sprint:**
            7
        -   [ ] **F28.2.9** --- Courier errands (User accepted this
            errand) should grey out the cancel errand button if the
            errand has been picked up. It should not be interactive. ---
            **Priority:** High · **Sprint:** 7
        -   [ ] **F28.2.10** --- Courier errands (User accepted this
            errand) should display a picked up button if the errand has
            not been picked up and greys it out after. This button will
            change the state of the errand to PICKED_UP. ---
            **Priority:** High · **Sprint:** 7
        -   [ ] **F28.2.11** --- Courier errands (User accepted this
            errand) should display a Delivered button after the errand
            has been picked up. It should be greyed out before. This
            button will change the state of the errand to
            PENDING_COMPLETION. --- **Priority:** High · **Sprint:** 7
