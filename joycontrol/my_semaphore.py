import asyncio

class _Request:
    def __init__(self, value):
        self.value = value
        # Python 3.10+: 使用 get_running_loop() 获取事件循环
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
        self.future = loop.create_future()


class MySemaphore:
    """
    An implementation of the asyncio-Semaphore with a few more features.
    Rewritten for Python 3.10+ compatibility (removed _loop dependency).
    """
    def __init__(self, value):
        self._value = value
        self._waiters = []  # Normal people would use an actual Queue
        self._aquired = 0

    def _check_next(self):
        while self._waiters and (self._waiters[0].future.done() or self._value >= self._waiters[0].value):
            r = self._waiters.pop(0)
            if not r.future.done():
                r.future.set_result(None)
                return

    async def acquire(self, count=1):
        if count < 0:
            raise ValueError("Semaphore acquire with count < 0")
        while self._value < count:
            r = _Request(count)
            self._waiters.append(r)
            try:
                await r.future
            except:
                r.future.cancel()
                # original has an if here, we wont take the call anymore, call the next one
                self._check_next()
                raise
        self._aquired += count
        self._value -= count
        self._check_next()
        return True

    def reduce(self, value):
        self._value -= value

    def increase(self, value):
        self._value += value
        self._check_next()

    def get_value(self):
        return self._value

    def get_aquired(self):
        return self._aquired

    def release(self, count=1):
        if count < 0:
            raise ValueError("Semaphore release with 0 < count")
        self._value += count
        self._aquired -= count
        self._check_next()

class MyBoundedSemaphore(MySemaphore):
    """
    Equivalent to asyncio.BoundedSemaphore,
    also with more features
    """
    def __init__(self, limit=1, value=None):
        super().__init__(value if value is not None else limit)
        self._limit = limit

    def get_limit(self):
        return self._limit

    def set_limit(self, value):
        self._limit = value
        self._value = min(self._value, self._limit)

    def release(self, count=1, best_effort=False):
        if self._value + count > self._limit:
            if best_effort:
                count = self._limit - self._value
            else:
                raise ValueError('BoundedSemaphore released too many times')
        super().release(count)
