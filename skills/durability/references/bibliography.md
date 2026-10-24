# Durability bibliography

Book principles and our Effect mappings are separate. Citations below name the text and chapter or section actually examined. Missing edition metadata stays missing. Public links identify the books. Each quote was checked against the text it cites.

## Books

## B1 erlang and otp in action

Logan, Martin; Merritt, Eric; Carlsson, Richard. _Erlang and OTP in Action_.

**Read:** The Erlang/OTP Platform: Let It Crash; process isolation; §4.2.2 supervisor restart strategy.

**Edition:** Edition, publisher, and year were not confirmed.

[Public book reference](https://www.manning.com/books/erlang-and-otp-in-action).

### Q01

> The point of letting an entire subsystem terminate and be restarted is that it brings you back to a state known to function properly.

## B2 elixir in action

Jurić, Saša. _Elixir in Action_, Third Edition. Manning, 2024.

**Read:** §5.4.3 Shared-Nothing Concurrency; Chapters 8–9, fault tolerance and supervision; Other Use Cases for ETS.

[Public book reference](https://www.manning.com/books/elixir-in-action-third-edition).

### Q02

> Remember from chapters 8 and 9 that processes lose their state on termination.

### Q03

> Shared-nothing concurrency ensures complete isolation between processes: one process can’t compromise the internal state of another.

## B3 designing elixir systems with otp

Gray II, James Edward; Tate, Bruce A. _Designing Elixir Systems with OTP_. Pragmatic Bookshelf, 2019.

**Read:** Build a Functional Core; Isolate Process Machinery in a Boundary; Customize Your Lifecycle; Big, Loud Worker-Bees; Add Persistence as a Boundary Service; Test the Boundary.

**Edition:** Edition not stated.

[Public book reference](https://pragprog.com/titles/jgotp/designing-elixir-systems-with-otp/).

### Q04

> Elixir can’t manage what it doesn’t know about.

### Q14

> Our core doesn’t access external interfaces or use any process machinery your component might use.

## B4 release it

Nygard, Michael T. _Release It!: Design and Deploy Production-Ready Software_. Pragmatic Bookshelf, 2007.

**Read:** §4.4 Unbounded Result Sets; Chapter 5 Stability Patterns: §5.1 Timeouts, §5.2 Circuit Breaker, §5.3 Bulkheads, §5.4 Steady State, §5.5 Fail Fast, §5.6 Handshaking, §5.7 Test Harness, §5.8 Decoupling Middleware.

**Edition:** Edition not stated. Do not substitute second-edition chapter numbering.

[Public book reference](https://archive.org/details/releaseitdesignd0000nyga).

### Q05

> The timeout is a simple mechanism allowing you to stop waiting for an answer once you think it will not come.

### Q06

> calls to the circuit breaker fail immediately, without any attempt to execute the real operation.

### Q07

> Protect critical clients by giving them their own pool to call.

### Q08

> The Steady State pattern says, for every mechanism that accumulates a resource, some other mechanism must recycle that resource.

### Q09

> The Test Harness can produce slow responses, no responses, or garbage responses.

## B5 building event driven microservices

Bellemare, Adam. _Building Event-Driven Microservices: Leveraging Organizational Data at Scale_. O’Reilly, 2020.

**Read:** Chapter 3 Communication and Data Contracts; Chapter 6 Deterministic Stream Processing; Chapter 7 Stateful Streaming; Chapter 9 Microservices Using Function-as-a-Service; Chapter 14 Supportive Tooling.

**Edition:** Edition not stated; citation is to the 2020 text.

[Public book reference](https://www.oreilly.com/library/view/building-event-driven-microservices/9781492057888/).

### Q11

> The overarching goal of deterministic processing is that a microservice should produce the same output whether it is processing in real time or catching up to the present time.

### Q12

> Schema evolution ensures that the consumer can translate it to a familiar version.

### Q13

> allowing a single stateful transaction to atomically update both the state and input offsets.

## B6 fundamentals of data engineering

Reis, Joe; Housley, Matt. _Fundamentals of Data Engineering_. O’Reilly.

**Read:** Part II, Chapter 5: Message Queues; DataOps considerations; Incident Response.

**Edition:** Edition and year not confirmed.

[Public book reference](https://www.oreilly.com/library/view/fundamentals-of-data/9781098108298).

### Q10

> In an idempotent system, the outcome of processing a message once is identical to the outcome of processing it multiple times.

## B7 domain modeling made functional

Wlaschin, Scott. _Domain Modeling Made Functional: Tackle Software Complexity with Domain-Driven Design and F#_. Pragmatic Bookshelf, 2018.

**Read:** Implementation: Working with Errors; Using the Result Type to Make Errors Explicit; Handling Exceptions; Composing in Parallel with Applicatives.

**Edition:** The copy is labeled P1.0; numbered edition not stated.

[Public book reference](https://pragprog.com/titles/swdddf/domain-modeling-made-functional/).

### Q15

> These different kinds of errors require different implementations.

## B8 monitoring distributed systems

Ewaschuk, Rob. _Monitoring Distributed Systems_. O’Reilly, 2016.

**Read:** The Four Golden Signals; Black-Box Versus White-Box; Symptoms Versus Causes.

**Edition:** First edition. Also a chapter of the Google SRE book.

[Public book reference](https://sre.google/sre-book/monitoring-distributed-systems/).

### Q18

> The four golden signals of monitoring are latency, traffic, errors, and saturation.

## B9 serverless architectures on aws

Sbarski, Peter; Cui, Yan; Nair, Ajay. _Serverless Architectures on AWS_, Second Edition.

**Read:** Chapter 6, The New Search Microservice: Everything Fails, All the Time; Pay Attention to Retry Configurations. AWS-specific mechanisms are not universal runtime guarantees.

**Edition:** Publisher and year not confirmed.

[Public book reference](https://www.manning.com/books/serverless-architectures-on-aws-second-edition).

### Q20

> Do you put the failed event into a DLQ and process it later?

## B10 a philosophy of software design

Ousterhout, John. _A Philosophy of Software Design_. 2018.

**Read:** §4.4 Deep Modules; §10.2 Too Many Exceptions; §10.3 Define Errors Out of Existence; §10.6 Mask Exceptions; §10.7 Exception Aggregation; §10.8 Just Crash?; §10.10 Taking It Too Far.

**Edition:** Edition and publisher not confirmed.

[Public book reference](https://web.stanford.edu/~ouster/cgi-bin/book.php).

### Q16

> Rather than throwing an error when unset is asked to delete an unknown variable, it should have simply returned without doing anything.

## B11 property based testing

Hebert, Fred. _Property-Based Testing with PropEr, Erlang, and Elixir_. Pragmatic Bookshelf, 2019.

**Read:** Chapter 7 Shrinking; Laying Out Stateful Properties; Testing Parallel Executions; Initial State for the State Machine; Adjusting the Model. Use the actual breaker’s threshold semantics.

**Edition:** Edition not stated.

[Public book reference](https://pragprog.com/titles/fhproper/property-based-testing-with-proper-erlang-and-elixir/).

### Q17

> Both function calls must be deterministic.

## B12 site reliability engineering

Beyer, Betsy; Jones, Chris; Petoff, Jennifer; Murphy, Niall Richard, editors. _Site Reliability Engineering: How Google Runs Production Systems_. O’Reilly, 2016.

**Read:** Chapter 3 Embracing Risk; Chapter 22 Addressing Cascading Failures (Mike Ulrich); Chapter 26 General Principles of SRE as Applied to Data Integrity; Chapter 27 Reliable Product Launches at Scale. Section-only excerpts limit detailed attribution.

**Edition:** Edition not stated.

[Public book reference](https://sre.google/sre-book/table-of-contents/).

## B13 grokking simplicity

Normand, Eric. _Grokking Simplicity: Taming Complex Software with Functional Thinking_. Manning, 2021.

**Read:** Chapters 15–17: Isolating Timelines, Sharing Resources Between Timelines, Coordinating Timelines.

**Edition:** Edition not stated.

[Public book reference](https://www.manning.com/books/grokking-simplicity).

## B14 refactoring databases

Ambler, Scott W.; Sadalage, Pramod J. _Refactoring Databases: Evolutionary Database Design_. Addison-Wesley, 2006.

**Read:** §3.11 What You Have Learned (transition period); Chapter 4 Deploying into Production.

**Edition:** Edition not stated.

[Public book reference](https://www.amazon.com/Refactoring-Databases-Evolutionary-paperback-Addison-Wesley/dp/0321774515).

### Q19

> many refactorings require you to run both the original and new versions of the schema in parallel during a transition period that is long enough to allow any applications accessing that portion of the schema time to be redeployed.

## B15 software engineering at google

Winters, Titus; Manshreck, Tom; Wright, Hyrum, editors. _Software Engineering at Google: Lessons Learned from Programming Over Time_. O’Reilly, 2020.

**Read:** Chapter 15 Deprecation: Deprecation Tooling and Preventing Backsliding; CI Is Alerting (hermetic and flaky tests).

**Edition:** Edition not stated.

[Public book reference](https://abseil.io/resources/swe-book).

## B16 why programs fail

Zeller, Andreas. _Why Programs Fail: A Guide to Systematic Debugging_. Morgan Kaufmann, 2009.

**Read:** Chapter 4 Reproducing the Problem Environment; Chapter 10 Reference Runs. Short section excerpts do not establish a complete debugging method.

**Edition:** Edition not stated.

## Coverage limits

The DDIA and Newman’s Building Microservices excerpts returned fragments or headings for much of their assigned scope. Those fragments do not establish detailed fencing, consensus, compensation, or replication claims. They are not used as stand-alone authority here. Adopting Elixir and Programming Elixir yielded no usable findings. The Scala record did not yield a usable passage. No book-derived hot-upgrade or Governor rule is added.

## Effect source

Effect contributors. _Effect_. The map was drafted against `effect@4.0.5` (commit `7f524e25cfb49a71ac39b0f44278d08d40dda5de`) and checked against the template's pinned `effect@4.0.0`. See [the Effect map](effect-map.md). All mappings and proposed checks are our reading, not claims that the book authors use or endorse this library.
