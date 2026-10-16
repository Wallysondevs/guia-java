/* =====================================================================
   javasim-lib.js — biblioteca grande do simulador de Java (Guia Java):
   coleções, interfaces funcionais, streams, Optional, java.time,
   BigDecimal/BigInteger, arquivos (sistema fictício), regex, concorrência.
   Carregado sob demanda por assets/javasim.js.
   ===================================================================== */
(function (global) {
  "use strict";
  var JavaSim = global.JavaSim || (typeof require === "function" ? require("./javasim.js") : null);
  JavaSim.addLib(function (J) {
    var I = J._i;
    var defLib = I.defLib, defExc = I.defExc, L = I.L, jstr = I.jstr, S = I.S, isStr = I.isStr, toStr = I.toStr;
    var jequals = I.jequals, jhash = I.jhash, jcompare = I.jcompare, jcall = I.jcall, throwJ = I.throwJ, npe = I.npe;
    var JBox = I.JBox, JArr = I.JArr, newArray = I.newArray, boxVal = I.boxVal, classOf = I.classOf, T = I.T, OBJ = I.OBJ;
    function RT() { return I.rt(); }
    function box(n, v) { return boxVal(n, v); }
    function unbox(v) { if (v === null) npe(); return v.v; }
    function num(v) { return v instanceof JBox ? (typeof v.v === "bigint" ? Number(v.v) : v.v) : v; }

    // ---------- chamadas a objetos funcionais ----------
    function call(fn, name, args) { if (fn === null) npe(); return jcall(fn, name, args); }
    function apply(f, x) { return call(f, "apply", [x]); }
    function apply2(f, x, y) { return call(f, "apply", [x, y]); }
    function test(p, x) { return call(p, "test", [x]); }
    function accept(c, x) { call(c, "accept", [x]); }
    function get(s) { return call(s, "get", []); }
    function cmp(c, a, b) { return c ? call(c, "compare", [a, b]) : jcompare(a, b); }

    // ---------- iteração genérica ----------
    function toArr(c) {
      if (c === null) npe();
      var sym = classOf(c);
      for (var s = sym; s; s = s.superT && s.superT.sym) if (s.toArr) return s.toArr(c);
      var r = [], it = jcall(c, "iterator", []);
      while (jcall(it, "hasNext", [])) r.push(jcall(it, "next", []));
      return r;
    }
    J.toArr = toArr;
    // iterador Java sobre um array JS (com verificação de modificação concorrente)
    function arrIter(owner, getArr, frames, removeFn) {
      var o = { $c: L("java.util.ArrayIteratorImpl"), i: 0, last: -1, owner: owner, mod: owner ? owner.mod : 0, getArr: getArr, frames: frames, removeFn: removeFn };
      return o;
    }
    defLib("java.util.Iterator", { kind: "interface", tp: "E", m: {
      "boolean hasNext()": null, "E next()": null,
      "void remove()": function () { throwJ("java.lang.UnsupportedOperationException", "remove"); },
      "void forEachRemaining(java.util.function.Consumer<? super E>)": function (c) { while (jcall(this, "hasNext", [])) accept(c, jcall(this, "next", [])); }
    } });
    defLib("java.util.ListIterator", { kind: "interface", tp: "E", impl: ["Iterator<E>"], m: {
      "boolean hasPrevious()": null, "E previous()": null, "void set(E)": null, "void add(E)": null, "int nextIndex()": null, "int previousIndex()": null
    } });
    var CME_FRAMES = { "java.util.ArrayList": ["java.base/java.util.ArrayList$Itr.checkForComodification(ArrayList.java:1096)", "java.base/java.util.ArrayList$Itr.next(ArrayList.java:1050)"],
      "java.util.HashMap": ["java.base/java.util.HashMap$HashIterator.nextNode(HashMap.java:1606)", "java.base/java.util.HashMap$KeyIterator.next(HashMap.java:1629)"],
      "java.util.LinkedList": ["java.base/java.util.LinkedList$ListItr.checkForComodification(LinkedList.java:977)", "java.base/java.util.LinkedList$ListItr.next(LinkedList.java:899)"] };
    defLib("java.util.ArrayIteratorImpl", { impl: ["ListIterator<Object>"], bin: "java.util.ArrayList$Itr", m: {
      "boolean hasNext()": function () { return this.i < this.getArr().length; },
      "Object next()": function () {
        if (this.owner && this.owner.mod !== this.mod) throwJ("java.util.ConcurrentModificationException", null, this.frames || CME_FRAMES["java.util.ArrayList"]);
        var a = this.getArr();
        if (this.i >= a.length) throwJ("java.util.NoSuchElementException", null, ["java.base/java.util.ArrayList$Itr.next(ArrayList.java:1053)"]);
        this.last = this.i;
        return a[this.i++];
      },
      "boolean hasPrevious()": function () { return this.i > 0; },
      "Object previous()": function () { var a = this.getArr(); if (this.i <= 0) throwJ("java.util.NoSuchElementException", null); this.i--; this.last = this.i; return a[this.i]; },
      "int nextIndex()": function () { return this.i; },
      "int previousIndex()": function () { return this.i - 1; },
      "void remove()": function () {
        if (this.last < 0) throwJ("java.lang.IllegalStateException", null, ["java.base/java.util.ArrayList$Itr.remove(ArrayList.java:1063)"]);
        if (!this.removeFn) throwJ("java.lang.UnsupportedOperationException", "remove");
        if (this.owner && this.owner.mod !== this.mod) throwJ("java.util.ConcurrentModificationException", null);
        this.removeFn(this.last);
        if (this.last < this.i) this.i--;
        this.last = -1;
        if (this.owner) this.mod = this.owner.mod;
      },
      "void set(Object)": function (v) { if (this.last < 0) throwJ("java.lang.IllegalStateException", null); this.getArr()[this.last] = v; },
      "void add(Object)": function (v) { this.owner.a.splice(this.i, 0, v); this.i++; this.last = -1; this.owner.mod++; this.mod = this.owner.mod; }
    } });

    // ---------- interfaces de coleções ----------
    function collStr(self, arr) {
      return jstr("[" + arr.map(function (x) { return x === self ? "(this Collection)" : toStr(x); }).join(", ") + "]");
    }
    defLib("java.util.Collection", { kind: "interface", tp: "E", impl: ["Iterable<E>"], m: {
      "int size()": null, "boolean isEmpty()": function () { return jcall(this, "size", []) === 0; },
      "boolean contains(Object)": function (o) { return toArr(this).some(function (x) { return jequals(o, x); }); },
      "boolean add(E)": null, "boolean remove(Object)": null,
      "boolean addAll(Collection<? extends E>)": function (c) { var self = this, ch = false; toArr(c).forEach(function (x) { if (jcall(self, "add", [x])) ch = true; }); return ch; },
      "boolean removeAll(Collection<?>)": function (c) { var self = this, ch = false, other = toArr(c); toArr(this).forEach(function (x) { if (other.some(function (y) { return jequals(x, y); })) { jcall(self, "remove", [x]); ch = true; } }); return ch; },
      "boolean retainAll(Collection<?>)": function (c) { var self = this, ch = false, other = toArr(c); toArr(this).forEach(function (x) { if (!other.some(function (y) { return jequals(x, y); })) { jcall(self, "remove", [x]); ch = true; } }); return ch; },
      "boolean containsAll(Collection<?>)": function (c) { var me = toArr(this); return toArr(c).every(function (x) { return me.some(function (y) { return jequals(x, y); }); }); },
      "boolean removeIf(java.util.function.Predicate<? super E>)": function (p) { var self = this, ch = false; toArr(this).forEach(function (x) { if (test(p, x)) { jcall(self, "remove", [x]); ch = true; } }); return ch; },
      "void clear()": null,
      "Object[] toArray()": function () { var a = toArr(this), r = newArray(OBJ(), a.length); a.forEach(function (x, i) { r.a[i] = x; }); return r; },
      "<T> T[] toArray(T[])": function (t) { var a = toArr(this); var r = t.a.length >= a.length ? t : new JArr(t.$c, new Array(a.length).fill(null)); a.forEach(function (x, i) { r.a[i] = x; }); if (r.a.length > a.length) r.a[a.length] = null; return r; },
      "<T> T[] toArray(java.util.function.IntFunction<T[]>)": function (g) { var a = toArr(this); var r = call(g, "apply", [0]); r = new JArr(r.$c, a.slice()); return r; },
      "java.util.stream.Stream<E> stream()": function () { return J.mkStream(toArr(this)); },
      "java.util.stream.Stream<E> parallelStream()": function () { return J.mkStream(toArr(this)); }
    } });
    defLib("java.util.SequencedCollection", { kind: "interface", tp: "E", impl: ["Collection<E>"], m: {
      "E getFirst()": function () { var a = toArr(this); if (!a.length) throwJ("java.util.NoSuchElementException", null); return a[0]; },
      "E getLast()": function () { var a = toArr(this); if (!a.length) throwJ("java.util.NoSuchElementException", null); return a[a.length - 1]; },
      "void addFirst(E)": function () { throwJ("java.lang.UnsupportedOperationException", null); },
      "void addLast(E)": function () { throwJ("java.lang.UnsupportedOperationException", null); },
      "E removeFirst()": function () { var a = toArr(this); if (!a.length) throwJ("java.util.NoSuchElementException", null); jcall(this, "remove", [a[0]]); return a[0]; },
      "E removeLast()": function () { var a = toArr(this); if (!a.length) throwJ("java.util.NoSuchElementException", null); jcall(this, "remove", [a[a.length - 1]]); return a[a.length - 1]; },
      "SequencedCollection<E> reversed()": function () { return mkList(toArr(this).reverse(), "java.util.ArrayList"); }
    } });

    // ---------- List ----------
    var IMM = ["java.base/java.util.ImmutableCollections.uoe(ImmutableCollections.java:159)"];
    function immListFail(meth) { throwJ("java.lang.UnsupportedOperationException", null, IMM.concat(["java.base/java.util.ImmutableCollections$AbstractImmutableList." + meth + "(ImmutableCollections.java:" + ({ remove: 277, set: 281, add: 270, sort: 285, replaceAll: 285 }[meth] || 277) + ")"])); }
    function immFail(meth) { throwJ("java.lang.UnsupportedOperationException", null, IMM.concat(["java.base/java.util.ImmutableCollections$AbstractImmutableCollection." + meth + "(ImmutableCollections.java:" + ({ add: 164, remove: 167, clear: 165, addAll: 165, removeIf: 168, set: 164 }[meth] || 164) + ")"])); }
    function idxFail(i, n, self, op) {
      if (self && self.$c.full === "java.util.LinkedList") throwJ("java.lang.IndexOutOfBoundsException", "Index: " + i + ", Size: " + n, ["java.base/java.util.LinkedList.checkElementIndex(LinkedList.java:567)", "java.base/java.util.LinkedList." + (op || "get") + "(LinkedList.java:" + ({ get: 488, set: 505, remove: 566 }[op || "get"] || 488) + ")"]);
      throwJ("java.lang.IndexOutOfBoundsException", "Index " + i + " out of bounds for length " + n, ["java.base/jdk.internal.util.Preconditions.outOfBounds(Preconditions.java:100)", "java.base/jdk.internal.util.Preconditions.outOfBoundsCheckIndex(Preconditions.java:106)", "java.base/jdk.internal.util.Preconditions.checkIndex(Preconditions.java:302)", "java.base/java.util.Objects.checkIndex(Objects.java:365)", "java.base/java.util.ArrayList." + (op || "get") + "(ArrayList.java:" + ({ get: 428, set: 471, remove: 552 }[op || "get"]) + ")"]);
    }
    function mut(self, op) {
      if (self.imm) immFail(op);
      if (self.fixed && (op === "add" || op === "remove" || op === "clear" || op === "addAll" || op === "removeIf")) throwJ("java.lang.UnsupportedOperationException", null, op === "add" ? ["java.base/java.util.AbstractList.add(AbstractList.java:155)", "java.base/java.util.AbstractList.add(AbstractList.java:113)"] : ["java.base/java.util.AbstractList.remove(AbstractList.java:169)"]);
    }
    function mkList(arr, cls, opts) {
      var o = { $c: L(cls || "java.util.ArrayList"), a: arr, mod: 0 };
      if (opts) for (var k in opts) o[k] = opts[k];
      return o;
    }
    J.mkList = mkList;
    function listEq(a, b) { if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (!(a[i] === null ? b[i] === null : jequals(a[i], b[i]))) return false; return true; }
    var LIST_M = {
      "int size()": function () { return this.a.length; },
      "boolean isEmpty()": function () { return this.a.length === 0; },
      "E get(int)": function (i) { if (i < 0 || i >= this.a.length) idxFail(i, this.a.length, this, "get"); return this.a[i]; },
      "E set(int,E)": function (i, v) { if (this.imm) immListFail("set"); if (i < 0 || i >= this.a.length) idxFail(i, this.a.length, this, "set"); var o = this.a[i]; this.a[i] = v; return o; },
      "boolean add(E)": function (v) { mut(this, "add"); this.a.push(v); this.mod++; return true; },
      "void add(int,E)": function (i, v) { mut(this, "add"); if (i < 0 || i > this.a.length) throwJ("java.lang.IndexOutOfBoundsException", "Index: " + i + ", Size: " + this.a.length, ["java.base/java.util.ArrayList.rangeCheckForAdd(ArrayList.java:839)", "java.base/java.util.ArrayList.add(ArrayList.java:511)"]); this.a.splice(i, 0, v); this.mod++; },
      "E remove(int)": function (i) { if (this.imm) immListFail("remove"); mut(this, "remove"); if (i < 0 || i >= this.a.length) idxFail(i, this.a.length, this, "remove"); this.mod++; return this.a.splice(i, 1)[0]; },
      "boolean remove(Object)": function (o) { mut(this, "remove"); for (var i = 0; i < this.a.length; i++) if (o === null ? this.a[i] === null : jequals(o, this.a[i])) { this.a.splice(i, 1); this.mod++; return true; } return false; },
      "boolean addAll(Collection<? extends E>)": function (c) { mut(this, "addAll"); var x = toArr(c); for (var i = 0; i < x.length; i++) this.a.push(x[i]); this.mod++; return x.length > 0; },
      "boolean addAll(int,Collection<? extends E>)": function (i, c) { mut(this, "addAll"); var x = toArr(c); Array.prototype.splice.apply(this.a, [i, 0].concat(x)); this.mod++; return x.length > 0; },
      "void clear()": function () { mut(this, "clear"); this.a.length = 0; this.mod++; },
      "boolean contains(Object)": function (o) { return this.a.some(function (x) { return o === null ? x === null : jequals(o, x); }); },
      "int indexOf(Object)": function (o) { for (var i = 0; i < this.a.length; i++) if (o === null ? this.a[i] === null : jequals(o, this.a[i])) return i; return -1; },
      "int lastIndexOf(Object)": function (o) { for (var i = this.a.length - 1; i >= 0; i--) if (o === null ? this.a[i] === null : jequals(o, this.a[i])) return i; return -1; },
      "Iterator<E> iterator()": function () { var self = this; return arrIter(this, function () { return self.a; }, null, function (i) { mut(self, "remove"); self.a.splice(i, 1); self.mod++; }); },
      "ListIterator<E> listIterator()": function () { var self = this; return arrIter(this, function () { return self.a; }, null, function (i) { self.a.splice(i, 1); self.mod++; }); },
      "List<E> subList(int,int)": function (a, b) { if (a < 0 || b > this.a.length || a > b) throwJ("java.lang.IndexOutOfBoundsException", "fromIndex: " + a + ", toIndex: " + b + ", size: " + this.a.length); return mkList(this.a.slice(a, b), "java.util.ArrayList"); },
      "void sort(Comparator<? super E>)": function (c) { if (this.imm) immFail("sort"); stableSort(this.a, c); this.mod++; },
      "void forEach(java.util.function.Consumer<? super E>)": function (c) { var m0 = this.mod; for (var i = 0; i < this.a.length; i++) { accept(c, this.a[i]); if (this.mod !== m0) throwJ("java.util.ConcurrentModificationException", null, ["java.base/java.util.ArrayList.forEach(ArrayList.java:1605)"]); } },
      "boolean removeIf(java.util.function.Predicate<? super E>)": function (p) { mut(this, "removeIf"); var n0 = this.a.length; this.a = this.a.filter(function (x) { return !test(p, x); }); if (this.a.length !== n0) this.mod++; return this.a.length !== n0; },
      "void replaceAll(java.util.function.UnaryOperator<E>)": function (f) { if (this.imm) immFail("replaceAll"); for (var i = 0; i < this.a.length; i++) this.a[i] = apply(f, this.a[i]); },
      "E getFirst()": function () { if (!this.a.length) throwJ("java.util.NoSuchElementException", null, this.$c.full === "java.util.LinkedList" ? ["java.base/java.util.LinkedList.getFirst(LinkedList.java:256)"] : null); return this.a[0]; },
      "E getLast()": function () { if (!this.a.length) throwJ("java.util.NoSuchElementException", null, this.$c.full === "java.util.LinkedList" ? ["java.base/java.util.LinkedList.getLast(LinkedList.java:269)"] : null); return this.a[this.a.length - 1]; },
      "void addFirst(E)": function (v) { mut(this, "add"); this.a.unshift(v); this.mod++; },
      "void addLast(E)": function (v) { mut(this, "add"); this.a.push(v); this.mod++; },
      "E removeFirst()": function () { mut(this, "remove"); if (!this.a.length) throwJ("java.util.NoSuchElementException", null); this.mod++; return this.a.shift(); },
      "E removeLast()": function () { mut(this, "remove"); if (!this.a.length) throwJ("java.util.NoSuchElementException", null); this.mod++; return this.a.pop(); },
      "List<E> reversed()": function () { return mkList(this.a.slice().reverse(), "java.util.ArrayList"); },
      "String toString()": function () { return collStr(this, this.a); },
      "boolean equals(Object)": function (o) { if (o === this) return true; if (o === null || !I.isSubClass(classOf(o), L("java.util.List"))) return false; return listEq(this.a, toArr(o)); },
      "int hashCode()": function () { var h = 1; this.a.forEach(function (x) { h = (Math.imul(31, h) + (x === null ? 0 : jhash(x))) | 0; }); return h; },
      "Object[] toArray()": function () { var r = newArray(OBJ(), this.a.length); for (var i = 0; i < this.a.length; i++) r.a[i] = this.a[i]; return r; },
      "java.util.stream.Stream<E> stream()": function () { return J.mkStream(this.a.slice()); }
    };
    defLib("java.util.List", { kind: "interface", tp: "E", impl: ["SequencedCollection<E>"], m: {
      "E get(int)": null, "E set(int,E)": null, "void add(int,E)": null, "E remove(int)": null, "int indexOf(Object)": null, "int lastIndexOf(Object)": null,
      "List<E> subList(int,int)": null, "ListIterator<E> listIterator()": null,
      "void sort(Comparator<? super E>)": function (c) { var a = toArr(this); stableSort(a, c); for (var i = 0; i < a.length; i++) jcall(this, "set", [i, a[i]]); },
      "void replaceAll(java.util.function.UnaryOperator<E>)": function (f) { var a = toArr(this); for (var i = 0; i < a.length; i++) jcall(this, "set", [i, apply(f, a[i])]); },
      "List<E> reversed()": function () { return mkList(toArr(this).reverse(), "java.util.ArrayList"); },
      "static <E> List<E> of()": function () { return mkList([], "java.util.ImmutableList", { imm: true }); },
      "static <E> List<E> of(E)": function () { var a = Array.from(arguments); a.forEach(function (x) { if (x === null) npe(); }); return mkList(a, "java.util.ImmutableList", { imm: true }); },
      "static <E> List<E> of(E,E)": function () { var a = Array.from(arguments); a.forEach(function (x) { if (x === null) throwJ("java.lang.NullPointerException", null, ["java.base/java.util.Objects.requireNonNull(Objects.java:220)", "java.base/java.util.ImmutableCollections$List12.<init>(ImmutableCollections.java:591)", "java.base/java.util.List.of(List.java:952)"]); }); return mkList(a, "java.util.ImmutableList", { imm: true }); },
      "static <E> List<E> of(E,E,E)": function () { var a = Array.from(arguments); a.forEach(function (x) { if (x === null) npe(); }); return mkList(a, "java.util.ImmutableList", { imm: true }); },
      "static <E> List<E> of(E,E,E,E)": function () { var a = Array.from(arguments); a.forEach(function (x) { if (x === null) npe(); }); return mkList(a, "java.util.ImmutableList", { imm: true }); },
      "static <E> List<E> of(E,E,E,E,E)": function () { var a = Array.from(arguments); a.forEach(function (x) { if (x === null) npe(); }); return mkList(a, "java.util.ImmutableList", { imm: true }); },
      "static <E> List<E> of(E,E,E,E,E,E)": function () { var a = Array.from(arguments); a.forEach(function (x) { if (x === null) npe(); }); return mkList(a, "java.util.ImmutableList", { imm: true }); },
      "static <E> List<E> of(E,E,E,E,E,E,E)": function () { var a = Array.from(arguments); a.forEach(function (x) { if (x === null) npe(); }); return mkList(a, "java.util.ImmutableList", { imm: true }); },
      "static <E> List<E> of(E,E,E,E,E,E,E,E)": function () { var a = Array.from(arguments); a.forEach(function (x) { if (x === null) npe(); }); return mkList(a, "java.util.ImmutableList", { imm: true }); },
      "static <E> List<E> of(E,E,E,E,E,E,E,E,E)": function () { var a = Array.from(arguments); a.forEach(function (x) { if (x === null) npe(); }); return mkList(a, "java.util.ImmutableList", { imm: true }); },
      "static <E> List<E> of(E,E,E,E,E,E,E,E,E,E)": function () { var a = Array.from(arguments); a.forEach(function (x) { if (x === null) npe(); }); return mkList(a, "java.util.ImmutableList", { imm: true }); },
      "static <E> List<E> of(E...)": function (a) { a.a.forEach(function (x) { if (x === null) npe(); }); return mkList(Array.from(a.a), "java.util.ImmutableList", { imm: true }); },
      "static <E> List<E> copyOf(Collection<? extends E>)": function (c) { return mkList(toArr(c), "java.util.ImmutableList", { imm: true }); }
    } });
    function listClass(full, bin) {
      var m = {}; Object.keys(LIST_M).forEach(function (k) { m[k] = LIST_M[k]; });
      m["<init>()"] = function () { this.a = []; this.mod = 0; };
      m["<init>(int)"] = function (n) { if (n < 0) throwJ("java.lang.IllegalArgumentException", "Illegal Capacity: " + n); this.a = []; this.mod = 0; };
      m["<init>(Collection<? extends E>)"] = function (c) { this.a = toArr(c).slice(); this.mod = 0; };
      return defLib(full, { tp: "E", impl: ["List<E>", "java.util.RandomAccess", "Cloneable", "java.io.Serializable"], m: m, bin: bin });
    }
    defLib("java.util.RandomAccess", { kind: "interface", m: {} });
    listClass("java.util.ArrayList");
    L("java.util.ArrayList").toArr = function (o) { return o.a.slice(); };
    listClass("java.util.ImmutableList", "java.util.ImmutableCollections$ListN");
    L("java.util.ImmutableList").toArr = function (o) { return o.a.slice(); };
    listClass("java.util.ArraysList", "java.util.Arrays$ArrayList");
    L("java.util.ArraysList").toArr = function (o) { return o.a.slice(); };

    // ---------- Queue / Deque / LinkedList / ArrayDeque / PriorityQueue / Stack ----------
    defLib("java.util.Queue", { kind: "interface", tp: "E", impl: ["Collection<E>"], m: {
      "boolean offer(E)": null, "E poll()": null, "E peek()": null, "E remove()": null, "E element()": null
    } });
    defLib("java.util.Deque", { kind: "interface", tp: "E", impl: ["Queue<E>", "SequencedCollection<E>"], m: {
      "void push(E)": null, "E pop()": null, "boolean offerFirst(E)": null, "boolean offerLast(E)": null, "E pollFirst()": null, "E pollLast()": null,
      "E peekFirst()": null, "E peekLast()": null, "Iterator<E> descendingIterator()": null
    } });
    var DQ = {
      "boolean offer(E)": function (v) { if (v === null && this.noNull) npe(); this.a.push(v); this.mod++; return true; },
      "boolean offerLast(E)": function (v) { if (v === null && this.noNull) npe(); this.a.push(v); this.mod++; return true; },
      "boolean offerFirst(E)": function (v) { if (v === null && this.noNull) npe(); this.a.unshift(v); this.mod++; return true; },
      "void push(E)": function (v) { if (v === null && this.noNull) npe(); this.a.unshift(v); this.mod++; },
      "E pop()": function () { if (!this.a.length) throwJ("java.util.NoSuchElementException", null, this.$c.full === "java.util.ArrayDeque" ? ["java.base/java.util.ArrayDeque.removeFirst(ArrayDeque.java:360)", "java.base/java.util.ArrayDeque.pop(ArrayDeque.java:591)"] : ["java.base/java.util.LinkedList.removeFirst(LinkedList.java:281)", "java.base/java.util.LinkedList.pop(LinkedList.java:812)"]); this.mod++; return this.a.shift(); },
      "E poll()": function () { if (!this.a.length) return null; this.mod++; return this.a.shift(); },
      "E pollFirst()": function () { if (!this.a.length) return null; this.mod++; return this.a.shift(); },
      "E pollLast()": function () { if (!this.a.length) return null; this.mod++; return this.a.pop(); },
      "E peek()": function () { return this.a.length ? this.a[0] : null; },
      "E peekFirst()": function () { return this.a.length ? this.a[0] : null; },
      "E peekLast()": function () { return this.a.length ? this.a[this.a.length - 1] : null; },
      "E element()": function () { if (!this.a.length) throwJ("java.util.NoSuchElementException", null); return this.a[0]; },
      "E remove()": function () { if (!this.a.length) throwJ("java.util.NoSuchElementException", null); this.mod++; return this.a.shift(); },
      "Iterator<E> descendingIterator()": function () { var r = this.a.slice().reverse(); return arrIter(null, function () { return r; }); }
    };
    (function () {
      var m = {}; Object.keys(LIST_M).forEach(function (k) { m[k] = LIST_M[k]; });
      Object.keys(DQ).forEach(function (k) { m[k] = DQ[k]; });
      m["<init>()"] = function () { this.a = []; this.mod = 0; };
      m["<init>(Collection<? extends E>)"] = function (c) { this.a = toArr(c).slice(); this.mod = 0; };
      defLib("java.util.LinkedList", { tp: "E", impl: ["List<E>", "Deque<E>", "Cloneable", "java.io.Serializable"], m: m });
      L("java.util.LinkedList").toArr = function (o) { return o.a.slice(); };
      var d = {}; Object.keys(DQ).forEach(function (k) { d[k] = DQ[k]; });
      ["int size()", "boolean isEmpty()", "boolean contains(Object)", "boolean remove(Object)", "void clear()", "String toString()", "Iterator<E> iterator()", "boolean addAll(Collection<? extends E>)", "void forEach(java.util.function.Consumer<? super E>)", "java.util.stream.Stream<E> stream()", "boolean removeIf(java.util.function.Predicate<? super E>)", "E getFirst()", "E getLast()", "E removeFirst()", "E removeLast()", "void addFirst(E)", "void addLast(E)", "Object[] toArray()"].forEach(function (k) { d[k] = LIST_M[k]; });
      d["boolean add(E)"] = function (v) { if (v === null) npe(); this.a.push(v); this.mod++; return true; };
      d["void addFirst(E)"] = function (v) { if (v === null) npe(); this.a.unshift(v); this.mod++; };
      d["void addLast(E)"] = function (v) { if (v === null) npe(); this.a.push(v); this.mod++; };
      d["<init>()"] = function () { this.a = []; this.mod = 0; this.noNull = true; };
      d["<init>(int)"] = function () { this.a = []; this.mod = 0; this.noNull = true; };
      d["<init>(Collection<? extends E>)"] = function (c) { this.a = toArr(c).slice(); this.mod = 0; this.noNull = true; };
      defLib("java.util.ArrayDeque", { tp: "E", impl: ["Deque<E>", "Cloneable", "java.io.Serializable"], m: d });
      L("java.util.ArrayDeque").toArr = function (o) { return o.a.slice(); };
      // Stack (Vector)
      var st = {}; Object.keys(LIST_M).forEach(function (k) { st[k] = LIST_M[k]; });
      st["<init>()"] = function () { this.a = []; this.mod = 0; };
      st["E push(E)"] = function (v) { this.a.push(v); this.mod++; return v; };
      st["E pop()"] = function () { if (!this.a.length) throwJ("java.util.EmptyStackException", null, ["java.base/java.util.Stack.peek(Stack.java:103)", "java.base/java.util.Stack.pop(Stack.java:85)"]); this.mod++; return this.a.pop(); };
      st["E peek()"] = function () { if (!this.a.length) throwJ("java.util.EmptyStackException", null, ["java.base/java.util.Stack.peek(Stack.java:103)"]); return this.a[this.a.length - 1]; };
      st["boolean empty()"] = function () { return this.a.length === 0; };
      st["int search(Object)"] = function (o) { for (var i = this.a.length - 1; i >= 0; i--) if (jequals(o, this.a[i])) return this.a.length - i; return -1; };
      defLib("java.util.Vector", { tp: "E", impl: ["List<E>", "java.util.RandomAccess"], m: { "<init>()": function () { this.a = []; this.mod = 0; } } });
      defLib("java.util.Stack", { tp: "E", ext: "java.util.Vector<E>", impl: ["List<E>"], m: st });
      L("java.util.Stack").toArr = function (o) { return o.a.slice(); };
      var vm = L("java.util.Vector").lib.spec.m; Object.keys(LIST_M).forEach(function (k) { if (!vm[k]) vm[k] = LIST_M[k]; });
      L("java.util.Vector").toArr = function (o) { return o.a.slice(); };
    })();
    // PriorityQueue: heap binário igual ao do JDK (a ordem de iteração/toString depende dele)
    function pqUp(q, k, x) { var a = q.a; while (k > 0) { var p = (k - 1) >>> 1, e = a[p]; if (cmp(q.cmp, x, e) >= 0) break; a[k] = e; k = p; } a[k] = x; }
    function pqDown(q, k, x) { var a = q.a, n = a.length, half = n >>> 1; while (k < half) { var c = 2 * k + 1, cc = a[c], r = c + 1; if (r < n && cmp(q.cmp, cc, a[r]) > 0) cc = a[c = r]; if (cmp(q.cmp, x, cc) <= 0) break; a[k] = cc; k = c; } a[k] = x; }
    function pqPoll(q) { var a = q.a; if (!a.length) return null; var r = a[0], x = a.pop(); if (a.length) pqDown(q, 0, x); q.mod++; return r; }
    function pqRemoveAt(q, i) { var a = q.a, s = a.length - 1; q.mod++; if (s === i) { a.pop(); return; } var moved = a.pop(); pqDown(q, i, moved); if (a[i] === moved) pqUp(q, i, moved); }
    defLib("java.util.PriorityQueue", { tp: "E", impl: ["Queue<E>", "java.io.Serializable"], m: {
      "<init>()": function () { this.a = []; this.cmp = null; this.mod = 0; },
      "<init>(int)": function () { this.a = []; this.cmp = null; this.mod = 0; },
      "<init>(Comparator<? super E>)": function (c) { this.a = []; this.cmp = c; this.mod = 0; },
      "<init>(int,Comparator<? super E>)": function (n, c) { this.a = []; this.cmp = c; this.mod = 0; },
      "<init>(Collection<? extends E>)": function (c) { var self = this; this.a = []; this.cmp = null; this.mod = 0; toArr(c).forEach(function (x) { self.a.push(x); pqUp(self, self.a.length - 1, x); }); },
      "boolean add(E)": function (v) { if (v === null) throwJ("java.lang.NullPointerException", null, ["java.base/java.util.PriorityQueue.offer(PriorityQueue.java:325)", "java.base/java.util.PriorityQueue.add(PriorityQueue.java:311)"]); this.a.push(v); pqUp(this, this.a.length - 1, v); this.mod++; return true; },
      "boolean offer(E)": function (v) { if (v === null) throwJ("java.lang.NullPointerException", null, ["java.base/java.util.PriorityQueue.offer(PriorityQueue.java:325)"]); this.a.push(v); pqUp(this, this.a.length - 1, v); this.mod++; return true; },
      "E poll()": function () { return pqPoll(this); },
      "E remove()": function () { if (!this.a.length) throwJ("java.util.NoSuchElementException", null); return pqPoll(this); },
      "E peek()": function () { return this.a.length ? this.a[0] : null; },
      "E element()": function () { if (!this.a.length) throwJ("java.util.NoSuchElementException", null); return this.a[0]; },
      "int size()": function () { return this.a.length; },
      "boolean isEmpty()": function () { return !this.a.length; },
      "void clear()": function () { this.a = []; this.mod++; },
      "boolean contains(Object)": function (o) { return this.a.some(function (x) { return jequals(o, x); }); },
      "boolean remove(Object)": function (o) { for (var i = 0; i < this.a.length; i++) if (jequals(o, this.a[i])) { pqRemoveAt(this, i); return true; } return false; },
      "Iterator<E> iterator()": function () { var self = this; return arrIter(this, function () { return self.a; }); },
      "String toString()": function () { return collStr(this, this.a); },
      "Comparator<? super E> comparator()": function () { return this.cmp; }
    } });
    L("java.util.PriorityQueue").toArr = function (o) { return o.a.slice(); };

    // ---------- HashMap (mesma tabela do JDK: a ordem de iteração é a do Java) ----------
    function spread(h) { return h ^ (h >>> 16); }
    function tableSizeFor(c) { var n = 1; while (n < c) n *= 2; return Math.max(n, 1); }
    function hmInit(m, cap) { m.tab = null; m.size = 0; m.mod = 0; m.thr = cap ? tableSizeFor(cap) : 0; }
    function hmResize(m) {
      var old = m.tab, oldCap = old ? old.length : 0, oldThr = m.thr, newCap, newThr;
      if (oldCap > 0) { newCap = oldCap * 2; newThr = m.thr * 2; }
      else if (oldThr > 0) { newCap = oldThr; newThr = Math.floor(newCap * 0.75); }
      else { newCap = 16; newThr = 12; }
      var tab = new Array(newCap).fill(null);
      if (old) {
        for (var j = 0; j < oldCap; j++) {
          var e = old[j];
          if (!e) continue;
          var loH = null, loT = null, hiH = null, hiT = null;
          while (e) {
            var nx = e.next; e.next = null;
            if ((e.hash & oldCap) === 0) { if (loT) loT.next = e; else loH = e; loT = e; }
            else { if (hiT) hiT.next = e; else hiH = e; hiT = e; }
            e = nx;
          }
          tab[j] = loH; tab[j + oldCap] = hiH;
        }
      }
      m.tab = tab; m.thr = newThr;
    }
    function keyHash(k) { return k === null ? 0 : spread(jhash(k)); }
    function keyEq(a, b) { return a === b || (a !== null && b !== null && jequals(a, b)); }
    function hmFind(m, k) {
      if (!m.tab) return null;
      var h = keyHash(k), e = m.tab[h & (m.tab.length - 1)];
      while (e) { if (e.hash === h && keyEq(e.key, k)) return e; e = e.next; }
      return null;
    }
    // atHead: merge/compute inserem no começo do balde (como o JDK)
    function hmPut(m, k, v, onlyIfAbsent, atHead) {
      var h = keyHash(k);
      if (atHead && (!m.tab || m.size > m.thr)) hmResize(m);
      if (!m.tab) hmResize(m);
      var i = h & (m.tab.length - 1), e = m.tab[i], last = null;
      while (e) { if (e.hash === h && keyEq(e.key, k)) { var old = e.value; if (!onlyIfAbsent || old === null) e.value = v; if (m.access) touch(m, e); return { old: old, existed: true }; } last = e; e = e.next; }
      var n = { hash: h, key: k, value: v, next: null };
      if (atHead) { n.next = m.tab[i]; m.tab[i] = n; }
      else if (last) last.next = n; else m.tab[i] = n;
      if (m.linked) linkAdd(m, n);
      m.mod++;
      m.size++;
      if (!atHead && m.size > m.thr) hmResize(m);
      return { old: null, existed: false };
    }
    function hmRemove(m, k) {
      if (!m.tab) return null;
      var h = keyHash(k), i = h & (m.tab.length - 1), e = m.tab[i], prev = null;
      while (e) {
        if (e.hash === h && keyEq(e.key, k)) {
          if (prev) prev.next = e.next; else m.tab[i] = e.next;
          if (m.linked) linkDel(m, e);
          m.size--; m.mod++;
          return e;
        }
        prev = e; e = e.next;
      }
      return null;
    }
    function hmEntries(m) {
      if (m.linked) { var r = []; for (var x = m.head; x; x = x.after) r.push(x); return r; }
      var out = [];
      if (!m.tab) return out;
      for (var i = 0; i < m.tab.length; i++) for (var e = m.tab[i]; e; e = e.next) out.push(e);
      return out;
    }
    function linkAdd(m, n) { n.before = m.tail; n.after = null; if (m.tail) m.tail.after = n; else m.head = n; m.tail = n; }
    function linkDel(m, n) { if (n.before) n.before.after = n.after; else m.head = n.after; if (n.after) n.after.before = n.before; else m.tail = n.before; }
    function touch(m, e) { if (m.tail !== e) { linkDel(m, e); linkAdd(m, e); } }
    function hmPutAll(m, src) {
      var es = mapEntries(src);
      if (!m.tab && es.length) { var t = es.length / 0.75 + 1; var tsf = tableSizeFor(Math.ceil(t)); if (tsf > m.thr) m.thr = tsf; }
      else if (es.length > m.thr && m.tab) { while (es.length > m.thr && m.tab.length < (1 << 30)) hmResize(m); }
      es.forEach(function (e) { hmPut(m, e.key, e.value); });
    }
    // entradas de qualquer Map (JS)
    function mapEntries(mp) {
      if (mp === null) npe();
      if (mp.tab !== undefined || mp.linked) return hmEntries(mp);
      if (mp.tm) return mp.tm.slice();
      var r = [], it = jcall(jcall(mp, "entrySet", []), "iterator", []);
      while (jcall(it, "hasNext", [])) { var en = jcall(it, "next", []); r.push({ key: jcall(en, "getKey", []), value: jcall(en, "getValue", []) }); }
      return r;
    }
    J.mapEntries = mapEntries;
    function mapStr(self, es) { return jstr("{" + es.map(function (e) { return (e.key === self ? "(this Map)" : toStr(e.key)) + "=" + (e.value === self ? "(this Map)" : toStr(e.value)); }).join(", ") + "}"); }
    function entryObj(e, owner) { return { $c: L("java.util.MapEntryImpl"), e: e, owner: owner }; }
    defLib("java.util.Map", { kind: "interface", tp: "K,V", m: {
      "int size()": null, "boolean isEmpty()": function () { return jcall(this, "size", []) === 0; },
      "V get(Object)": null, "V put(K,V)": null, "V remove(Object)": null, "boolean containsKey(Object)": null, "boolean containsValue(Object)": null,
      "void clear()": null, "Set<K> keySet()": null, "Collection<V> values()": null, "Set<Map.Entry<K,V>> entrySet()": null,
      "void putAll(Map<? extends K,? extends V>)": function (o) { var self = this; mapEntries(o).forEach(function (e) { jcall(self, "put", [e.key, e.value]); }); },
      "V getOrDefault(Object,V)": function (k, d) { return jcall(this, "containsKey", [k]) ? jcall(this, "get", [k]) : d; },
      "V putIfAbsent(K,V)": function (k, v) { var o = jcall(this, "get", [k]); if (o === null) jcall(this, "put", [k, v]); return o; },
      "void forEach(java.util.function.BiConsumer<? super K,? super V>)": function (f) { mapEntries(this).forEach(function (e) { call(f, "accept", [e.key, e.value]); }); },
      "V merge(K,V,java.util.function.BiFunction<? super V,? super V,? extends V>)": function (k, v, f) { var o = jcall(this, "get", [k]); var n = o === null ? v : apply2(f, o, v); if (n === null) jcall(this, "remove", [k]); else jcall(this, "put", [k, n]); return n; },
      "V computeIfAbsent(K,java.util.function.Function<? super K,? extends V>)": function (k, f) { var o = jcall(this, "get", [k]); if (o !== null) return o; var n = apply(f, k); if (n !== null) jcall(this, "put", [k, n]); return n; },
      "V computeIfPresent(K,java.util.function.BiFunction<? super K,? super V,? extends V>)": function (k, f) { var o = jcall(this, "get", [k]); if (o === null) return null; var n = apply2(f, k, o); if (n === null) jcall(this, "remove", [k]); else jcall(this, "put", [k, n]); return n; },
      "V compute(K,java.util.function.BiFunction<? super K,? super V,? extends V>)": function (k, f) { var o = jcall(this, "get", [k]); var n = apply2(f, k, o); if (n === null) jcall(this, "remove", [k]); else jcall(this, "put", [k, n]); return n; },
      "V replace(K,V)": function (k, v) { if (jcall(this, "containsKey", [k])) return jcall(this, "put", [k, v]); return null; },
      "void replaceAll(java.util.function.BiFunction<? super K,? super V,? extends V>)": function (f) { var self = this; mapEntries(this).forEach(function (e) { jcall(self, "put", [e.key, apply2(f, e.key, e.value)]); }); },
      "static <K,V> Map<K,V> of()": function () { return immMap([]); },
      "static <K,V> Map<K,V> of(K,V)": function (a, b) { return immMap([a, b]); },
      "static <K,V> Map<K,V> of(K,V,K,V)": function () { return immMap(Array.from(arguments)); },
      "static <K,V> Map<K,V> of(K,V,K,V,K,V)": function () { return immMap(Array.from(arguments)); },
      "static <K,V> Map<K,V> of(K,V,K,V,K,V,K,V)": function () { return immMap(Array.from(arguments)); },
      "static <K,V> Map<K,V> of(K,V,K,V,K,V,K,V,K,V)": function () { return immMap(Array.from(arguments)); },
      "static <K,V> Map<K,V> of(K,V,K,V,K,V,K,V,K,V,K,V)": function () { return immMap(Array.from(arguments)); },
      "static <K,V> Map<K,V> of(K,V,K,V,K,V,K,V,K,V,K,V,K,V)": function () { return immMap(Array.from(arguments)); },
      "static <K,V> Map<K,V> of(K,V,K,V,K,V,K,V,K,V,K,V,K,V,K,V)": function () { return immMap(Array.from(arguments)); },
      "static <K,V> Map<K,V> ofEntries(Map.Entry<? extends K,? extends V>...)": function (a) { var kv = []; a.a.forEach(function (e) { kv.push(jcall(e, "getKey", []), jcall(e, "getValue", [])); }); return immMap(kv); },
      "static <K,V> Map.Entry<K,V> entry(K,V)": function (k, v) { return entryObj({ key: k, value: v }, null); },
      "static <K,V> Map<K,V> copyOf(Map<? extends K,? extends V>)": function (m) { var kv = []; mapEntries(m).forEach(function (e) { kv.push(e.key, e.value); }); return immMap(kv); }
    } });
    defLib("java.util.Map.Entry", { kind: "interface", tp: "K,V", m: {
      "K getKey()": null, "V getValue()": null, "V setValue(V)": null,
      "static <K extends Comparable<? super K>,V> Comparator<Map.Entry<K,V>> comparingByKey()": function () { return J.mkComparator(function (a, b) { return jcompare(jcall(a, "getKey", []), jcall(b, "getKey", [])); }); },
      "static <K,V extends Comparable<? super V>> Comparator<Map.Entry<K,V>> comparingByValue()": function () { return J.mkComparator(function (a, b) { return jcompare(jcall(a, "getValue", []), jcall(b, "getValue", [])); }); },
      "static <K,V> Comparator<Map.Entry<K,V>> comparingByKey(Comparator<? super K>)": function (c) { return J.mkComparator(function (a, b) { return cmp(c, jcall(a, "getKey", []), jcall(b, "getKey", [])); }); },
      "static <K,V> Comparator<Map.Entry<K,V>> comparingByValue(Comparator<? super V>)": function (c) { return J.mkComparator(function (a, b) { return cmp(c, jcall(a, "getValue", []), jcall(b, "getValue", [])); }); }
    } });
    defLib("java.util.MapEntryImpl", { tp: "K,V", impl: ["Map.Entry<K,V>"], bin: "java.util.HashMap$Node", m: {
      "K getKey()": function () { return this.e.key; },
      "V getValue()": function () { return this.e.value; },
      "V setValue(V)": function (v) { if (this.imm) throwJ("java.lang.UnsupportedOperationException", null); var o = this.e.value; this.e.value = v; return o; },
      "String toString()": function () { return jstr(toStr(this.e.key) + "=" + toStr(this.e.value)); },
      "boolean equals(Object)": function (o) { return o !== null && o.e !== undefined && keyEq(this.e.key, o.e.key) && keyEq(this.e.value, o.e.value); },
      "int hashCode()": function () { return (this.e.key === null ? 0 : jhash(this.e.key)) ^ (this.e.value === null ? 0 : jhash(this.e.value)); }
    } });
    defLib("java.util.AbstractMap.SimpleEntry", { tp: "K,V", impl: ["Map.Entry<K,V>"], bin: "java.util.AbstractMap$SimpleEntry", m: {
      "<init>(K,V)": function (k, v) { this.e = { key: k, value: v }; },
      "K getKey()": function () { return this.e.key; }, "V getValue()": function () { return this.e.value; },
      "V setValue(V)": function (v) { var o = this.e.value; this.e.value = v; return o; },
      "String toString()": function () { return jstr(toStr(this.e.key) + "=" + toStr(this.e.value)); },
      "boolean equals(Object)": function (o) { return o !== null && o.e !== undefined && keyEq(this.e.key, o.e.key) && keyEq(this.e.value, o.e.value); },
      "int hashCode()": function () { return (this.e.key === null ? 0 : jhash(this.e.key)) ^ (this.e.value === null ? 0 : jhash(this.e.value)); }
    } });
    if (!L("java.util.AbstractMap.SimpleEntry").outer) { /* AbstractMap não existe: ok */ }
    // visão (keySet/values/entrySet) — cópias vivas o suficiente para iterar e remover
    function viewOf(m, kind) { return { $c: L(kind === "values" ? "java.util.MapValuesView" : "java.util.MapSetView"), m: m, kind: kind, mod: 0 }; }
    function viewArr(v) {
      var es = mapEntries(v.m);
      if (v.kind === "keys") return es.map(function (e) { return e.key; });
      if (v.kind === "values") return es.map(function (e) { return e.value; });
      return es.map(function (e) { return entryObj(e, v.m); });
    }
    var VIEW = {
      "int size()": function () { return jcall(this.m, "size", []); },
      "boolean isEmpty()": function () { return jcall(this.m, "size", []) === 0; },
      "boolean contains(Object)": function (o) { if (this.kind === "keys") return jcall(this.m, "containsKey", [o]); return viewArr(this).some(function (x) { return keyEq(x, o); }); },
      "Iterator<E> iterator()": function () {
        var self = this, arr = viewArr(this), m = this.m;
        var it = arrIter(m, function () { return arr; }, CME_FRAMES["java.util.HashMap"], function (i) { var k = self.kind === "entries" ? arr[i].e.key : self.kind === "keys" ? arr[i] : mapEntries(m)[i].key; jcall(m, "remove", [k]); arr.splice(i, 1); });
        return it;
      },
      "boolean remove(Object)": function (o) { if (this.kind === "keys") { var had = jcall(this.m, "containsKey", [o]); jcall(this.m, "remove", [o]); return had; } var self = this, es = mapEntries(this.m); for (var i = 0; i < es.length; i++) if (keyEq(es[i].value, o)) { jcall(self.m, "remove", [es[i].key]); return true; } return false; },
      "boolean add(E)": function () { throwJ("java.lang.UnsupportedOperationException", null); },
      "void clear()": function () { jcall(this.m, "clear", []); },
      "String toString()": function () { return collStr(this, viewArr(this)); },
      "boolean removeIf(java.util.function.Predicate<? super E>)": function (p) { var self = this, ch = false; mapEntries(this.m).forEach(function (en) { var x = self.kind === "keys" ? en.key : self.kind === "values" ? en.value : entryObj(en, self.m); if (test(p, x)) { jcall(self.m, "remove", [en.key]); ch = true; } }); return ch; },
      "boolean equals(Object)": function (o) { var a = viewArr(this), b = toArr(o); return a.length === b.length && a.every(function (x) { return b.some(function (y) { return keyEq(x, y); }); }); },
      "int hashCode()": function () { var h = 0; viewArr(this).forEach(function (x) { h = (h + (x === null ? 0 : jhash(x))) | 0; }); return h; }
    };
    defLib("java.util.MapSetView", { tp: "E", impl: ["Set<E>"], bin: "java.util.HashMap$KeySet", m: VIEW });
    defLib("java.util.MapValuesView", { tp: "E", impl: ["Collection<E>"], bin: "java.util.HashMap$Values", m: VIEW });
    L("java.util.MapSetView").toArr = viewArr; L("java.util.MapValuesView").toArr = viewArr;
    var HM = {
      "<init>()": function () { hmInit(this, 0); },
      "<init>(int)": function (n) { if (n < 0) throwJ("java.lang.IllegalArgumentException", "Illegal initial capacity: " + n); hmInit(this, n); },
      "<init>(int,float)": function (n) { hmInit(this, n); },
      "<init>(Map<? extends K,? extends V>)": function (src) { hmInit(this, 0); hmPutAll(this, src); },
      "int size()": function () { return this.size; },
      "boolean isEmpty()": function () { return this.size === 0; },
      "V get(Object)": function (k) { var e = hmFind(this, k); if (e && this.access) touch(this, e); return e ? e.value : null; },
      "V getOrDefault(Object,V)": function (k, d) { var e = hmFind(this, k); return e ? e.value : d; },
      "boolean containsKey(Object)": function (k) { return !!hmFind(this, k); },
      "boolean containsValue(Object)": function (v) { return hmEntries(this).some(function (e) { return keyEq(e.value, v); }); },
      "V put(K,V)": function (k, v) { return hmPut(this, k, v).old; },
      "V putIfAbsent(K,V)": function (k, v) { return hmPut(this, k, v, true).old; },
      "void putAll(Map<? extends K,? extends V>)": function (o) { hmPutAll(this, o); },
      "V remove(Object)": function (k) { var e = hmRemove(this, k); return e ? e.value : null; },
      "void clear()": function () { if (this.tab) this.tab.fill(null); this.size = 0; this.mod++; this.head = this.tail = null; },
      "Set<K> keySet()": function () { return viewOf(this, "keys"); },
      "Collection<V> values()": function () { return viewOf(this, "values"); },
      "Set<Map.Entry<K,V>> entrySet()": function () { return viewOf(this, "entries"); },
      "V merge(K,V,java.util.function.BiFunction<? super V,? super V,? extends V>)": function (k, v, f) {
        if (v === null) npe();
        if (!this.tab || this.size > this.thr) hmResize(this);
        var e = hmFind(this, k);
        if (e) { var n = e.value === null ? v : apply2(f, e.value, v); if (n === null) hmRemove(this, k); else { e.value = n; if (this.access) touch(this, e); } return n; }
        hmPut(this, k, v, false, true); return v;
      },
      "V computeIfAbsent(K,java.util.function.Function<? super K,? extends V>)": function (k, f) {
        if (!this.tab || this.size > this.thr) hmResize(this);
        var e = hmFind(this, k);
        if (e && e.value !== null) return e.value;
        var m0 = this.mod;
        var n = apply(f, k);
        if (this.mod !== m0) throwJ("java.util.ConcurrentModificationException", null);
        if (n === null) return null;
        if (e) { e.value = n; return n; }
        hmPut(this, k, n, false, true); return n;
      },
      "V computeIfPresent(K,java.util.function.BiFunction<? super K,? super V,? extends V>)": function (k, f) { var e = hmFind(this, k); if (!e || e.value === null) return null; var n = apply2(f, k, e.value); if (n === null) hmRemove(this, k); else e.value = n; return n; },
      "V compute(K,java.util.function.BiFunction<? super K,? super V,? extends V>)": function (k, f) {
        if (!this.tab || this.size > this.thr) hmResize(this);
        var e = hmFind(this, k), n = apply2(f, k, e ? e.value : null);
        if (e) { if (n === null) hmRemove(this, k); else e.value = n; return n; }
        if (n !== null) hmPut(this, k, n, false, true);
        return n;
      },
      "void forEach(java.util.function.BiConsumer<? super K,? super V>)": function (f) { var m0 = this.mod; var es = hmEntries(this); for (var i = 0; i < es.length; i++) { call(f, "accept", [es[i].key, es[i].value]); if (this.mod !== m0) throwJ("java.util.ConcurrentModificationException", null); } },
      "String toString()": function () { return mapStr(this, hmEntries(this)); },
      "boolean equals(Object)": function (o) { return mapEquals(this, o); },
      "int hashCode()": function () { var h = 0; hmEntries(this).forEach(function (e) { h = (h + ((e.key === null ? 0 : jhash(e.key)) ^ (e.value === null ? 0 : jhash(e.value)))) | 0; }); return h; },
      "Object clone()": function () { var c = { $c: this.$c }; hmInit(c, 0); c.linked = this.linked; hmPutAll(c, this); return c; }
    };
    function mapEquals(a, o) {
      if (a === o) return true;
      if (o === null || !I.isSubClass(classOf(o), L("java.util.Map"))) return false;
      var ea = mapEntries(a), eb = mapEntries(o);
      if (ea.length !== eb.length) return false;
      return ea.every(function (e) { return jcall(o, "containsKey", [e.key]) && keyEq(e.value, jcall(o, "get", [e.key])); });
    }
    defLib("java.util.HashMap", { tp: "K,V", impl: ["Map<K,V>", "Cloneable", "java.io.Serializable"], m: HM });
    var LHM = {};
    Object.keys(HM).forEach(function (k) { LHM[k] = HM[k]; });
    LHM["<init>()"] = function () { hmInit(this, 0); this.linked = true; this.head = this.tail = null; };
    LHM["<init>(int)"] = function (n) { hmInit(this, n); this.linked = true; this.head = this.tail = null; };
    LHM["<init>(int,float)"] = function (n) { hmInit(this, n); this.linked = true; this.head = this.tail = null; };
    LHM["<init>(int,float,boolean)"] = function (n, f, acc) { hmInit(this, n); this.linked = true; this.head = this.tail = null; this.access = acc; };
    LHM["<init>(Map<? extends K,? extends V>)"] = function (src) { hmInit(this, 0); this.linked = true; this.head = this.tail = null; hmPutAll(this, src); };
    LHM["protected boolean removeEldestEntry(Map.Entry<K,V>)"] = function () { return false; };
    LHM["V put(K,V)"] = function (k, v) {
      var r = hmPut(this, k, v);
      if (!r.existed && this.head && jcall(this, "removeEldestEntry", [entryObj(this.head, this)])) hmRemove(this, this.head.key);
      return r.old;
    };
    defLib("java.util.LinkedHashMap", { tp: "K,V", ext: "java.util.HashMap<K,V>", impl: ["Map<K,V>", "java.util.SequencedMap<K,V>"], m: LHM });
    defLib("java.util.SequencedMap", { kind: "interface", tp: "K,V", impl: ["Map<K,V>"], m: {
      "Map.Entry<K,V> firstEntry()": function () { var es = mapEntries(this); return es.length ? entryObj(es[0], null) : null; },
      "Map.Entry<K,V> lastEntry()": function () { var es = mapEntries(this); return es.length ? entryObj(es[es.length - 1], null) : null; }
    } });
    function immMap(kv) {
      var m = { $c: L("java.util.ImmutableMap") };
      hmInit(m, 0); m.linked = false; m.imm = true;
      for (var i = 0; i < kv.length; i += 2) {
        if (kv[i] === null || kv[i + 1] === null) npe();
        if (hmFind(m, kv[i])) throwJ("java.lang.IllegalArgumentException", "duplicate key: " + toStr(kv[i]), ["java.base/java.util.ImmutableCollections$MapN.<init>(ImmutableCollections.java:1440)", "java.base/java.util.Map.of(Map.java:1384)"]);
        hmPut(m, kv[i], kv[i + 1]);
      }
      return m;
    }
    var IMMM = {};
    Object.keys(HM).forEach(function (k) { IMMM[k] = HM[k]; });
    ["V put(K,V)", "V remove(Object)", "void clear()", "void putAll(Map<? extends K,? extends V>)", "V merge(K,V,java.util.function.BiFunction<? super V,? super V,? extends V>)", "V computeIfAbsent(K,java.util.function.Function<? super K,? extends V>)", "V putIfAbsent(K,V)", "V compute(K,java.util.function.BiFunction<? super K,? super V,? extends V>)"].forEach(function (k) {
      IMMM[k] = function () { var nm = k.replace(/^\S+ (\w+)\(.*$/, "$1"); throwJ("java.lang.UnsupportedOperationException", null, IMM.concat(["java.base/java.util.ImmutableCollections$AbstractImmutableMap." + nm + "(ImmutableCollections.java:" + ({ put: 1318, remove: 1321, clear: 1312, putAll: 1319, merge: 1315, computeIfAbsent: 1311, putIfAbsent: 1320, compute: 1309 }[nm] || 1318) + ")"])); };
    });
    defLib("java.util.ImmutableMap", { tp: "K,V", impl: ["Map<K,V>"], bin: "java.util.ImmutableCollections$MapN", m: IMMM });
    // EnumMap: ordem dos ordinais
    defLib("java.util.EnumMap", { tp: "K extends Enum<K>,V", ext: "java.util.TreeMap<K,V>", m: {
      "<init>(Class<K>)": function () { this.tm = []; this.cmp = null; this.mod = 0; }
    } });

    // ---------- TreeMap (array ordenado) ----------
    function tmFind(m, k) {
      var a = m.tm, lo = 0, hi = a.length - 1;
      if (k === null && !m.cmp) npe();
      while (lo <= hi) { var mid = (lo + hi) >> 1, c = cmp(m.cmp, a[mid].key, k); if (c === 0) return { i: mid, found: true }; if (c < 0) lo = mid + 1; else hi = mid - 1; }
      return { i: lo, found: false };
    }
    function tmPut(m, k, v, viaSet) {
      if (!m.tm.length) { if (m.cmp) cmp(m.cmp, k, k); else jcompare(k, k, ["java.base/java.util.TreeMap.compare(TreeMap.java:1605)", "java.base/java.util.TreeMap.addEntryToEmptyMap(TreeMap.java:810)", "java.base/java.util.TreeMap.put(TreeMap.java:819)", "java.base/java.util.TreeMap.put(TreeMap.java:568)"].concat(viaSet ? ["java.base/java.util.TreeSet.add(TreeSet.java:261)"] : [])); }
      var r = tmFind(m, k);
      if (r.found) { var o = m.tm[r.i].value; m.tm[r.i].value = v; return o; }
      m.tm.splice(r.i, 0, { key: k, value: v }); m.mod++;
      return null;
    }
    function tmEntry(e) { return e ? entryObj(e, null) : null; }
    function tmKey(e) { return e ? e.key : null; }
    function navIdx(m, k, kind) {
      var r = tmFind(m, k), a = m.tm;
      switch (kind) {
        case "floor": return r.found ? r.i : r.i - 1;
        case "lower": return r.i - 1;
        case "ceiling": return r.i;
        case "higher": return r.found ? r.i + 1 : r.i;
      }
    }
    function tmSub(m, lo, loInc, hi, hiInc) {
      var r = { $c: L("java.util.TreeMap"), tm: [], cmp: m.cmp, mod: 0 };
      m.tm.forEach(function (e) {
        if (lo !== undefined) { var c1 = cmp(m.cmp, e.key, lo); if (c1 < 0 || (c1 === 0 && !loInc)) return; }
        if (hi !== undefined) { var c2 = cmp(m.cmp, e.key, hi); if (c2 > 0 || (c2 === 0 && !hiInc)) return; }
        r.tm.push({ key: e.key, value: e.value });
      });
      return r;
    }
    var TM = {
      "<init>()": function () { this.tm = []; this.cmp = null; this.mod = 0; },
      "<init>(Comparator<? super K>)": function (c) { this.tm = []; this.cmp = c; this.mod = 0; },
      "<init>(Map<? extends K,? extends V>)": function (src) { var self = this; this.tm = []; this.cmp = null; this.mod = 0; mapEntries(src).forEach(function (e) { tmPut(self, e.key, e.value); }); },
      "int size()": function () { return this.tm.length; },
      "boolean isEmpty()": function () { return !this.tm.length; },
      "V get(Object)": function (k) { var r = tmFind(this, k); return r.found ? this.tm[r.i].value : null; },
      "boolean containsKey(Object)": function (k) { return tmFind(this, k).found; },
      "boolean containsValue(Object)": function (v) { return this.tm.some(function (e) { return keyEq(e.value, v); }); },
      "V put(K,V)": function (k, v) { return tmPut(this, k, v); },
      "V remove(Object)": function (k) { var r = tmFind(this, k); if (!r.found) return null; this.mod++; return this.tm.splice(r.i, 1)[0].value; },
      "void clear()": function () { this.tm = []; this.mod++; },
      "Set<K> keySet()": function () { return viewOf(this, "keys"); },
      "NavigableSet<K> navigableKeySet()": function () { return viewOf(this, "keys"); },
      "Collection<V> values()": function () { return viewOf(this, "values"); },
      "Set<Map.Entry<K,V>> entrySet()": function () { return viewOf(this, "entries"); },
      "K firstKey()": function () { if (!this.tm.length) throwJ("java.util.NoSuchElementException", null, ["java.base/java.util.TreeMap.key(TreeMap.java:1638)", "java.base/java.util.TreeMap.firstKey(TreeMap.java:303)"]); return this.tm[0].key; },
      "K lastKey()": function () { if (!this.tm.length) throwJ("java.util.NoSuchElementException", null, ["java.base/java.util.TreeMap.key(TreeMap.java:1638)", "java.base/java.util.TreeMap.lastKey(TreeMap.java:314)"]); return this.tm[this.tm.length - 1].key; },
      "Map.Entry<K,V> firstEntry()": function () { return tmEntry(this.tm[0]); },
      "Map.Entry<K,V> lastEntry()": function () { return tmEntry(this.tm[this.tm.length - 1]); },
      "Map.Entry<K,V> pollFirstEntry()": function () { this.mod++; return tmEntry(this.tm.shift()); },
      "Map.Entry<K,V> pollLastEntry()": function () { this.mod++; return tmEntry(this.tm.pop()); },
      "K floorKey(K)": function (k) { return tmKey(this.tm[navIdx(this, k, "floor")]); },
      "K ceilingKey(K)": function (k) { return tmKey(this.tm[navIdx(this, k, "ceiling")]); },
      "K lowerKey(K)": function (k) { return tmKey(this.tm[navIdx(this, k, "lower")]); },
      "K higherKey(K)": function (k) { return tmKey(this.tm[navIdx(this, k, "higher")]); },
      "Map.Entry<K,V> floorEntry(K)": function (k) { return tmEntry(this.tm[navIdx(this, k, "floor")]); },
      "Map.Entry<K,V> ceilingEntry(K)": function (k) { return tmEntry(this.tm[navIdx(this, k, "ceiling")]); },
      "Map.Entry<K,V> lowerEntry(K)": function (k) { return tmEntry(this.tm[navIdx(this, k, "lower")]); },
      "Map.Entry<K,V> higherEntry(K)": function (k) { return tmEntry(this.tm[navIdx(this, k, "higher")]); },
      "SortedMap<K,V> headMap(K)": function (k) { return tmSub(this, undefined, false, k, false); },
      "NavigableMap<K,V> headMap(K,boolean)": function (k, inc) { return tmSub(this, undefined, false, k, inc); },
      "SortedMap<K,V> tailMap(K)": function (k) { return tmSub(this, k, true); },
      "NavigableMap<K,V> tailMap(K,boolean)": function (k, inc) { return tmSub(this, k, inc); },
      "SortedMap<K,V> subMap(K,K)": function (a, b) { return tmSub(this, a, true, b, false); },
      "NavigableMap<K,V> descendingMap()": function () { var self = this; var r = { $c: L("java.util.TreeMap"), tm: this.tm.slice().reverse(), cmp: J.mkComparator(function (a, b) { return -cmp(self.cmp, a, b); }), mod: 0 }; return r; },
      "NavigableSet<K> descendingKeySet()": function () { return J.mkTreeSetFrom(this.tm.slice().reverse().map(function (e) { return e.key; }), null, true); },
      "Comparator<? super K> comparator()": function () { return this.cmp; },
      "String toString()": function () { return mapStr(this, this.tm); },
      "boolean equals(Object)": function (o) { return mapEquals(this, o); },
      "int hashCode()": function () { var h = 0; this.tm.forEach(function (e) { h = (h + ((e.key === null ? 0 : jhash(e.key)) ^ (e.value === null ? 0 : jhash(e.value)))) | 0; }); return h; }
    };
    defLib("java.util.SortedMap", { kind: "interface", tp: "K,V", impl: ["java.util.SequencedMap<K,V>"], m: { "K firstKey()": null, "K lastKey()": null } });
    defLib("java.util.NavigableMap", { kind: "interface", tp: "K,V", impl: ["SortedMap<K,V>"], m: {} });
    defLib("java.util.TreeMap", { tp: "K,V", impl: ["NavigableMap<K,V>", "Cloneable", "java.io.Serializable"], m: TM });
    var EM = L("java.util.EnumMap");
    EM.lib.spec.ext = "java.util.TreeMap<K,V>";

    // ---------- Sets ----------
    defLib("java.util.Set", { kind: "interface", tp: "E", impl: ["Collection<E>"], m: {
      "static <E> Set<E> of()": function () { return immSet([]); },
      "static <E> Set<E> of(E)": function () { return immSet(Array.from(arguments)); },
      "static <E> Set<E> of(E,E)": function () { return immSet(Array.from(arguments)); },
      "static <E> Set<E> of(E,E,E)": function () { return immSet(Array.from(arguments)); },
      "static <E> Set<E> of(E,E,E,E)": function () { return immSet(Array.from(arguments)); },
      "static <E> Set<E> of(E,E,E,E,E)": function () { return immSet(Array.from(arguments)); },
      "static <E> Set<E> of(E,E,E,E,E,E)": function () { return immSet(Array.from(arguments)); },
      "static <E> Set<E> of(E,E,E,E,E,E,E)": function () { return immSet(Array.from(arguments)); },
      "static <E> Set<E> of(E,E,E,E,E,E,E,E)": function () { return immSet(Array.from(arguments)); },
      "static <E> Set<E> of(E,E,E,E,E,E,E,E,E)": function () { return immSet(Array.from(arguments)); },
      "static <E> Set<E> of(E,E,E,E,E,E,E,E,E,E)": function () { return immSet(Array.from(arguments)); },
      "static <E> Set<E> of(E...)": function (a) { return immSet(Array.from(a.a)); },
      "static <E> Set<E> copyOf(Collection<? extends E>)": function (c) { var seen = mkHashSet([]); var r = []; toArr(c).forEach(function (x) { if (!hmFind(seen.m, x)) { hmPut(seen.m, x, true); r.push(x); } }); return immSet(r); }
    } });
    defLib("java.util.SequencedSet", { kind: "interface", tp: "E", impl: ["Set<E>", "SequencedCollection<E>"], m: {} });
    defLib("java.util.SortedSet", { kind: "interface", tp: "E", impl: ["SequencedSet<E>"], m: { "E first()": null, "E last()": null } });
    defLib("java.util.NavigableSet", { kind: "interface", tp: "E", impl: ["SortedSet<E>"], m: {} });
    function setArr(s) { return hmEntries(s.m).map(function (e) { return e.key; }); }
    var HS = {
      "<init>()": function () { this.m = {}; hmInit(this.m, 0); this.mod = 0; },
      "<init>(int)": function (n) { this.m = {}; hmInit(this.m, n); this.mod = 0; },
      "<init>(Collection<? extends E>)": function (c) { var a = toArr(c); this.m = {}; hmInit(this.m, Math.max(Math.floor(a.length / 0.75) + 1, 16)); var self = this; a.forEach(function (x) { hmPut(self.m, x, true); }); this.mod = 0; },
      "int size()": function () { return this.m.size; },
      "boolean isEmpty()": function () { return this.m.size === 0; },
      "boolean add(E)": function (x) { if (this.imm) immFail("add"); var r = hmPut(this.m, x, true, true); if (!r.existed) this.mod++; return !r.existed; },
      "boolean contains(Object)": function (x) { return !!hmFind(this.m, x); },
      "boolean remove(Object)": function (x) { if (this.imm) immFail("remove"); var r = !!hmRemove(this.m, x); if (r) this.mod++; return r; },
      "void clear()": function () { if (this.imm) immFail("clear"); hmInit(this.m, 0); this.m.linked = this.linked; this.m.head = this.m.tail = null; this.mod++; },
      "Iterator<E> iterator()": function () { var self = this, arr = setArr(this); return arrIter(this, function () { return arr; }, CME_FRAMES["java.util.HashMap"], function (i) { hmRemove(self.m, arr[i]); arr.splice(i, 1); self.mod++; }); },
      "String toString()": function () { return collStr(this, setArr(this)); },
      "boolean equals(Object)": function (o) { if (o === this) return true; if (o === null || !I.isSubClass(classOf(o), L("java.util.Set"))) return false; var a = setArr(this), b = toArr(o); var self = this; return a.length === b.length && b.every(function (x) { return !!hmFind(self.m, x); }); },
      "int hashCode()": function () { var h = 0; setArr(this).forEach(function (x) { h = (h + (x === null ? 0 : jhash(x))) | 0; }); return h; },
      "boolean addAll(Collection<? extends E>)": function (c) { if (this.imm) immFail("addAll"); var self = this, ch = false; toArr(c).forEach(function (x) { if (!hmPut(self.m, x, true, true).existed) ch = true; }); if (ch) this.mod++; return ch; },
      "boolean removeIf(java.util.function.Predicate<? super E>)": function (p) { if (this.imm) immFail("removeIf"); var self = this, ch = false; setArr(this).forEach(function (x) { if (test(p, x)) { hmRemove(self.m, x); ch = true; } }); return ch; }
    };
    defLib("java.util.HashSet", { tp: "E", impl: ["Set<E>", "Cloneable", "java.io.Serializable"], m: HS });
    L("java.util.HashSet").toArr = setArr;
    var LHS = {}; Object.keys(HS).forEach(function (k) { LHS[k] = HS[k]; });
    LHS["<init>()"] = function () { this.m = {}; hmInit(this.m, 0); this.m.linked = true; this.m.head = this.m.tail = null; this.linked = true; this.mod = 0; };
    LHS["<init>(int)"] = function (n) { this.m = {}; hmInit(this.m, n); this.m.linked = true; this.m.head = this.m.tail = null; this.linked = true; this.mod = 0; };
    LHS["<init>(Collection<? extends E>)"] = function (c) { var a = toArr(c); this.m = {}; hmInit(this.m, Math.max(2 * a.length, 11)); this.m.linked = true; this.m.head = this.m.tail = null; this.linked = true; var self = this; a.forEach(function (x) { hmPut(self.m, x, true, true); }); this.mod = 0; };
    defLib("java.util.LinkedHashSet", { tp: "E", ext: "java.util.HashSet<E>", impl: ["SequencedSet<E>"], m: LHS });
    function mkHashSet(arr, linked) { var s = { $c: L(linked ? "java.util.LinkedHashSet" : "java.util.HashSet"), m: {}, mod: 0 }; hmInit(s.m, 0); if (linked) { s.m.linked = true; s.m.head = s.m.tail = null; s.linked = true; } arr.forEach(function (x) { hmPut(s.m, x, true, true); }); return s; }
    J.mkHashSet = mkHashSet;
    // Set.of: ordem fixa (no Java real depende de um "SALT" aleatório a cada execução)
    function immSet(arr) {
      var s = { $c: L("java.util.ImmutableSet"), m: {}, mod: 0, imm: true };
      hmInit(s.m, 0); s.m.linked = true; s.m.head = s.m.tail = null;
      arr.forEach(function (x) { if (x === null) npe(); if (hmFind(s.m, x)) throwJ("java.lang.IllegalArgumentException", "duplicate element: " + toStr(x)); hmPut(s.m, x, true); });
      return s;
    }
    defLib("java.util.ImmutableSet", { tp: "E", impl: ["Set<E>"], bin: "java.util.ImmutableCollections$SetN", m: HS });
    L("java.util.ImmutableSet").toArr = setArr;
    // TreeSet
    function tsArr(s) { return s.t.tm.map(function (e) { return e.key; }); }
    var TS = {
      "<init>()": function () { this.t = { tm: [], cmp: null }; this.mod = 0; },
      "<init>(Comparator<? super E>)": function (c) { this.t = { tm: [], cmp: c }; this.mod = 0; },
      "<init>(Collection<? extends E>)": function (c) { var self = this; this.t = { tm: [], cmp: null }; this.mod = 0; toArr(c).forEach(function (x) { tmPut(self.t, x, true); }); },
      "int size()": function () { return this.t.tm.length; },
      "boolean isEmpty()": function () { return !this.t.tm.length; },
      "boolean add(E)": function (x) { var had = this.t.tm.length && tmFind(this.t, x).found; if (had) return false; tmPut(this.t, x, true, true); this.mod++; return true; },
      "boolean contains(Object)": function (x) { return tmFind(this.t, x).found; },
      "boolean remove(Object)": function (x) { var r = tmFind(this.t, x); if (!r.found) return false; this.t.tm.splice(r.i, 1); this.mod++; return true; },
      "void clear()": function () { this.t.tm = []; this.mod++; },
      "Iterator<E> iterator()": function () { var self = this, arr = tsArr(this); return arrIter(this, function () { return arr; }, null, function (i) { var r = tmFind(self.t, arr[i]); self.t.tm.splice(r.i, 1); arr.splice(i, 1); self.mod++; }); },
      "Iterator<E> descendingIterator()": function () { var arr = tsArr(this).reverse(); return arrIter(null, function () { return arr; }); },
      "E first()": function () { if (!this.t.tm.length) throwJ("java.util.NoSuchElementException", null); return this.t.tm[0].key; },
      "E last()": function () { if (!this.t.tm.length) throwJ("java.util.NoSuchElementException", null); return this.t.tm[this.t.tm.length - 1].key; },
      "E pollFirst()": function () { this.mod++; var e = this.t.tm.shift(); return e ? e.key : null; },
      "E pollLast()": function () { this.mod++; var e = this.t.tm.pop(); return e ? e.key : null; },
      "E floor(E)": function (k) { return tmKey(this.t.tm[navIdx(this.t, k, "floor")]); },
      "E ceiling(E)": function (k) { return tmKey(this.t.tm[navIdx(this.t, k, "ceiling")]); },
      "E lower(E)": function (k) { return tmKey(this.t.tm[navIdx(this.t, k, "lower")]); },
      "E higher(E)": function (k) { return tmKey(this.t.tm[navIdx(this.t, k, "higher")]); },
      "SortedSet<E> headSet(E)": function (k) { return J.mkTreeSetFrom(tmSub(this.t, undefined, false, k, false).tm.map(function (e) { return e.key; }), this.t.cmp); },
      "NavigableSet<E> headSet(E,boolean)": function (k, inc) { return J.mkTreeSetFrom(tmSub(this.t, undefined, false, k, inc).tm.map(function (e) { return e.key; }), this.t.cmp); },
      "SortedSet<E> tailSet(E)": function (k) { return J.mkTreeSetFrom(tmSub(this.t, k, true).tm.map(function (e) { return e.key; }), this.t.cmp); },
      "NavigableSet<E> tailSet(E,boolean)": function (k, inc) { return J.mkTreeSetFrom(tmSub(this.t, k, inc).tm.map(function (e) { return e.key; }), this.t.cmp); },
      "SortedSet<E> subSet(E,E)": function (a, b) { return J.mkTreeSetFrom(tmSub(this.t, a, true, b, false).tm.map(function (e) { return e.key; }), this.t.cmp); },
      "NavigableSet<E> descendingSet()": function () { var self = this; return J.mkTreeSetFrom(tsArr(this).reverse(), J.mkComparator(function (a, b) { return -cmp(self.t.cmp, a, b); })); },
      "Comparator<? super E> comparator()": function () { return this.t.cmp; },
      "String toString()": function () { return collStr(this, tsArr(this)); },
      "boolean equals(Object)": function (o) { if (o === null || !I.isSubClass(classOf(o), L("java.util.Set"))) return false; var a = tsArr(this), b = toArr(o); var self = this; return a.length === b.length && b.every(function (x) { return tmFind(self.t, x).found; }); },
      "int hashCode()": function () { var h = 0; tsArr(this).forEach(function (x) { h = (h + jhash(x)) | 0; }); return h; }
    };
    defLib("java.util.TreeSet", { tp: "E", impl: ["NavigableSet<E>", "Cloneable", "java.io.Serializable"], m: TS });
    L("java.util.TreeSet").toArr = tsArr;
    J.mkTreeSetFrom = function (arr, c) { var s = { $c: L("java.util.TreeSet"), t: { tm: [], cmp: c || null }, mod: 0 }; arr.forEach(function (x) { tmPut(s.t, x, true); }); return s; };
    defLib("java.util.EnumSet", { tp: "E extends Enum<E>", ext: "java.util.TreeSet<E>", m: {
      "static <E extends Enum<E>> EnumSet<E> of(E,E...)": function (a, rest) { return mkEnumSet([a].concat(Array.from(rest.a))); },
      "static <E extends Enum<E>> EnumSet<E> of(E)": function (a) { return mkEnumSet([a]); },
      "static <E extends Enum<E>> EnumSet<E> noneOf(Class<E>)": function () { return mkEnumSet([]); },
      "static <E extends Enum<E>> EnumSet<E> allOf(Class<E>)": function (c) { var sym = c.t.sym; I.ensureInit(sym); return mkEnumSet(RT().enumVals[sym.id].slice()); },
      "static <E extends Enum<E>> EnumSet<E> range(E,E)": function (a, b) { var sym = classOf(a).isEnum() ? classOf(a) : classOf(a).superT.sym; var vs = RT().enumVals[sym.id]; return mkEnumSet(vs.slice(a.$ord, b.$ord + 1)); }
    } });
    function mkEnumSet(arr) { var s = { $c: L("java.util.EnumSet"), t: { tm: [], cmp: null }, mod: 0 }; arr.forEach(function (x) { tmPut(s.t, x, true); }); return s; }
    L("java.util.EnumSet").bin = "java.util.RegularEnumSet";

    // ---------- ordenação estável (como o TimSort: estável) ----------
    function stableSort(a, c) {
      var idx = a.map(function (x, i) { return [x, i]; });
      idx.sort(function (p, q) { var r = cmp(c, p[0], q[0]); return r !== 0 ? (r < 0 ? -1 : 1) : p[1] - q[1]; });
      for (var i = 0; i < a.length; i++) a[i] = idx[i][0];
    }
    J.stableSort = stableSort;

    // ---------- Comparator ----------
    function mkComparator(fn) { return { $c: L("java.util.ComparatorImpl"), f: fn }; }
    J.mkComparator = mkComparator;
    function keyCmp(f, c) { return function (a, b) { return cmp(c, apply(f, a), apply(f, b)); }; }
    defLib("java.util.Comparator", { kind: "interface", tp: "T", m: {
      "int compare(T,T)": null,
      "Comparator<T> reversed()": function () { var self = this; return mkComparator(function (a, b) { return cmp(self, b, a); }); },
      "Comparator<T> thenComparing(Comparator<? super T>)": function (o) { var self = this; return mkComparator(function (a, b) { var r = cmp(self, a, b); return r !== 0 ? r : cmp(o, a, b); }); },
      "<U extends Comparable<? super U>> Comparator<T> thenComparing(java.util.function.Function<? super T,? extends U>)": function (f) { var self = this, k = keyCmp(f); return mkComparator(function (a, b) { var r = cmp(self, a, b); return r !== 0 ? r : k(a, b); }); },
      "<U> Comparator<T> thenComparing(java.util.function.Function<? super T,? extends U>,Comparator<? super U>)": function (f, c) { var self = this, k = keyCmp(f, c); return mkComparator(function (a, b) { var r = cmp(self, a, b); return r !== 0 ? r : k(a, b); }); },
      "Comparator<T> thenComparingInt(java.util.function.ToIntFunction<? super T>)": function (f) { var self = this; return mkComparator(function (a, b) { var r = cmp(self, a, b); if (r !== 0) return r; var x = call(f, "applyAsInt", [a]), y = call(f, "applyAsInt", [b]); return x < y ? -1 : x > y ? 1 : 0; }); },
      "Comparator<T> thenComparingDouble(java.util.function.ToDoubleFunction<? super T>)": function (f) { var self = this; return mkComparator(function (a, b) { var r = cmp(self, a, b); if (r !== 0) return r; return I.doubleCompare(call(f, "applyAsDouble", [a]), call(f, "applyAsDouble", [b])); }); },
      "Comparator<T> thenComparingLong(java.util.function.ToLongFunction<? super T>)": function (f) { var self = this; return mkComparator(function (a, b) { var r = cmp(self, a, b); if (r !== 0) return r; var x = call(f, "applyAsLong", [a]), y = call(f, "applyAsLong", [b]); return x < y ? -1 : x > y ? 1 : 0; }); },
      "static <T,U extends Comparable<? super U>> Comparator<T> comparing(java.util.function.Function<? super T,? extends U>)": function (f) { return mkComparator(keyCmp(f)); },
      "static <T,U> Comparator<T> comparing(java.util.function.Function<? super T,? extends U>,Comparator<? super U>)": function (f, c) { return mkComparator(keyCmp(f, c)); },
      "static <T> Comparator<T> comparingInt(java.util.function.ToIntFunction<? super T>)": function (f) { return mkComparator(function (a, b) { var x = call(f, "applyAsInt", [a]), y = call(f, "applyAsInt", [b]); return x < y ? -1 : x > y ? 1 : 0; }); },
      "static <T> Comparator<T> comparingDouble(java.util.function.ToDoubleFunction<? super T>)": function (f) { return mkComparator(function (a, b) { return I.doubleCompare(call(f, "applyAsDouble", [a]), call(f, "applyAsDouble", [b])); }); },
      "static <T> Comparator<T> comparingLong(java.util.function.ToLongFunction<? super T>)": function (f) { return mkComparator(function (a, b) { var x = call(f, "applyAsLong", [a]), y = call(f, "applyAsLong", [b]); return x < y ? -1 : x > y ? 1 : 0; }); },
      "static <T extends Comparable<? super T>> Comparator<T> naturalOrder()": function () { return mkComparator(function (a, b) { return jcompare(a, b); }); },
      "static <T extends Comparable<? super T>> Comparator<T> reverseOrder()": function () { return mkComparator(function (a, b) { return jcompare(b, a); }); },
      "static <T> Comparator<T> nullsFirst(Comparator<? super T>)": function (c) { return mkComparator(function (a, b) { if (a === null) return b === null ? 0 : -1; if (b === null) return 1; return c === null ? 0 : cmp(c, a, b); }); },
      "static <T> Comparator<T> nullsLast(Comparator<? super T>)": function (c) { return mkComparator(function (a, b) { if (a === null) return b === null ? 0 : 1; if (b === null) return -1; return c === null ? 0 : cmp(c, a, b); }); }
    } });
    defLib("java.util.ComparatorImpl", { tp: "T", impl: ["Comparator<T>"], bin: "java.util.Comparator$$Lambda", m: { "int compare(T,T)": function (a, b) { return this.f(a, b); } } });
    J.caseInsensitive = function () { return mkComparator(function (a, b) { return I.compareStrings(S(a).toUpperCase().toLowerCase(), S(b).toUpperCase().toLowerCase()); }); };

    // ---------- interfaces funcionais ----------
    var F = "java.util.function.";
    function fi(name, tp, sam, extra) { var m = {}; m[sam] = null; if (extra) Object.keys(extra).forEach(function (k) { m[k] = extra[k]; }); defLib(F + name, { kind: "interface", tp: tp, m: m }); }
    function mkFn(iface, fn) { var sym = L(F + iface); return { $c: J.lambdaClass(sym), fn: fn }; }
    J.mkFn = mkFn;
    fi("Function", "T,R", "R apply(T)", {
      "<V> Function<V,R> compose(Function<? super V,? extends T>)": function (b) { var a = this; return mkFn("Function", function (x) { return apply(a, apply(b, x)); }); },
      "<V> Function<T,V> andThen(Function<? super R,? extends V>)": function (b) { var a = this; return mkFn("Function", function (x) { return apply(b, apply(a, x)); }); },
      "static <T> Function<T,T> identity()": function () { return mkFn("Function", function (x) { return x; }); }
    });
    fi("BiFunction", "T,U,R", "R apply(T,U)", { "<V> BiFunction<T,U,V> andThen(Function<? super R,? extends V>)": function (b) { var a = this; return mkFn("BiFunction", function (x, y) { return apply(b, apply2(a, x, y)); }); } });
    fi("UnaryOperator", "T", "T apply(T)", { "static <T> UnaryOperator<T> identity()": function () { return mkFn("UnaryOperator", function (x) { return x; }); } });
    L(F + "UnaryOperator").lib.spec.impl = ["Function<T,T>"];
    L(F + "UnaryOperator").lib.spec.m = { "static <T> UnaryOperator<T> identity()": function () { return mkFn("UnaryOperator", function (x) { return x; }); } };
    fi("BinaryOperator", "T", "T apply(T,T)", {
      "static <T> BinaryOperator<T> minBy(java.util.Comparator<? super T>)": function (c) { return mkFn("BinaryOperator", function (a, b) { return cmp(c, a, b) <= 0 ? a : b; }); },
      "static <T> BinaryOperator<T> maxBy(java.util.Comparator<? super T>)": function (c) { return mkFn("BinaryOperator", function (a, b) { return cmp(c, a, b) >= 0 ? a : b; }); }
    });
    L(F + "BinaryOperator").lib.spec.impl = ["BiFunction<T,T,T>"];
    delete L(F + "BinaryOperator").lib.spec.m["T apply(T,T)"];
    fi("Consumer", "T", "void accept(T)", { "Consumer<T> andThen(Consumer<? super T>)": function (b) { var a = this; return mkFn("Consumer", function (x) { accept(a, x); accept(b, x); }); } });
    fi("BiConsumer", "T,U", "void accept(T,U)", {});
    fi("Supplier", "T", "T get()", {});
    fi("Predicate", "T", "boolean test(T)", {
      "Predicate<T> and(Predicate<? super T>)": function (b) { var a = this; return mkFn("Predicate", function (x) { return test(a, x) && test(b, x); }); },
      "Predicate<T> or(Predicate<? super T>)": function (b) { var a = this; return mkFn("Predicate", function (x) { return test(a, x) || test(b, x); }); },
      "Predicate<T> negate()": function () { var a = this; return mkFn("Predicate", function (x) { return !test(a, x); }); },
      "static <T> Predicate<T> not(Predicate<? super T>)": function (a) { return mkFn("Predicate", function (x) { return !test(a, x); }); },
      "static <T> Predicate<T> isEqual(Object)": function (o) { return mkFn("Predicate", function (x) { return o === null ? x === null : jequals(o, x); }); }
    });
    fi("BiPredicate", "T,U", "boolean test(T,U)", {});
    fi("IntFunction", "R", "R apply(int)", {}); fi("IntPredicate", "", "boolean test(int)", { "IntPredicate negate()": function () { var a = this; return mkFn("IntPredicate", function (x) { return !call(a, "test", [x]); }); } });
    fi("IntUnaryOperator", "", "int applyAsInt(int)", {}); fi("IntBinaryOperator", "", "int applyAsInt(int,int)", {});
    fi("IntConsumer", "", "void accept(int)", {}); fi("IntSupplier", "", "int getAsInt()", {});
    fi("ToIntFunction", "T", "int applyAsInt(T)", {}); fi("ToLongFunction", "T", "long applyAsLong(T)", {}); fi("ToDoubleFunction", "T", "double applyAsDouble(T)", {});
    fi("ToIntBiFunction", "T,U", "int applyAsInt(T,U)", {});
    fi("IntToDoubleFunction", "", "double applyAsDouble(int)", {}); fi("IntToLongFunction", "", "long applyAsLong(int)", {});
    fi("DoubleUnaryOperator", "", "double applyAsDouble(double)", {}); fi("DoubleBinaryOperator", "", "double applyAsDouble(double,double)", {});
    fi("DoubleFunction", "R", "R apply(double)", {}); fi("DoublePredicate", "", "boolean test(double)", {}); fi("DoubleConsumer", "", "void accept(double)", {});
    fi("DoubleSupplier", "", "double getAsDouble()", {}); fi("DoubleToIntFunction", "", "int applyAsInt(double)", {});
    fi("LongFunction", "R", "R apply(long)", {}); fi("LongPredicate", "", "boolean test(long)", {}); fi("LongUnaryOperator", "", "long applyAsLong(long)", {});
    fi("LongBinaryOperator", "", "long applyAsLong(long,long)", {}); fi("LongSupplier", "", "long getAsLong()", {}); fi("BooleanSupplier", "", "boolean getAsBoolean()", {});
    fi("ObjIntConsumer", "T", "void accept(T,int)", {});
    defLib("java.util.concurrent.Callable", { kind: "interface", tp: "V", m: { "V call() throws Exception": null } });
  });
})(typeof window !== "undefined" ? window : globalThis);
(function (global) {
  "use strict";
  var JavaSim = global.JavaSim || (typeof require === "function" ? require("./javasim.js") : null);
  JavaSim.addLib(function (J) {
    var I = J._i;
    var defLib = I.defLib, L = I.L, jstr = I.jstr, S = I.S, toStr = I.toStr, jequals = I.jequals, jhash = I.jhash, jcompare = I.jcompare;
    var jcall = I.jcall, throwJ = I.throwJ, npe = I.npe, JBox = I.JBox, JArr = I.JArr, newArray = I.newArray, boxVal = I.boxVal, classOf = I.classOf, T = I.T, OBJ = I.OBJ;
    var toArr = J.toArr, mkList = J.mkList, stableSort = J.stableSort, mkFn = J.mkFn;
    function RT() { return I.rt(); }
    function call(fn, name, args) { if (fn === null) npe(); return jcall(fn, name, args); }
    function apply(f, x) { return call(f, "apply", [x]); }
    function test(p, x) { return call(p, "test", [x]); }
    function accept(c, x) { call(c, "accept", [x]); }
    function cmp(c, a, b) { return c ? call(c, "compare", [a, b]) : jcompare(a, b); }
    function box(n, v) { return boxVal(n, v); }
    function keyEq(a, b) { return a === b || (a !== null && b !== null && jequals(a, b)); }

    // ---------- Optional ----------
    function mkOpt(v) { return { $c: L("java.util.Optional"), v: v }; }
    var EMPTY_NSE = function () { throwJ("java.util.NoSuchElementException", "No value present", ["java.base/java.util.Optional.get(Optional.java:143)"]); };
    defLib("java.util.Optional", { tp: "T", flags: "public final", noCtor: true, m: {
      "static <T> Optional<T> of(T)": function (v) { if (v === null) throwJ("java.lang.NullPointerException", null, ["java.base/java.util.Objects.requireNonNull(Objects.java:220)", "java.base/java.util.Optional.of(Optional.java:113)"]); return mkOpt(v); },
      "static <T> Optional<T> ofNullable(T)": function (v) { return mkOpt(v); },
      "static <T> Optional<T> empty()": function () { return mkOpt(null); },
      "boolean isPresent()": function () { return this.v !== null; },
      "boolean isEmpty()": function () { return this.v === null; },
      "T get()": function () { if (this.v === null) EMPTY_NSE(); return this.v; },
      "T orElseThrow()": function () { if (this.v === null) throwJ("java.util.NoSuchElementException", "No value present", ["java.base/java.util.Optional.orElseThrow(Optional.java:377)"]); return this.v; },
      "<X extends Throwable> T orElseThrow(java.util.function.Supplier<? extends X>) throws X": function (s) { if (this.v === null) throw new I.JavaThrow(call(s, "get", [])); return this.v; },
      "T orElse(T)": function (d) { return this.v !== null ? this.v : d; },
      "T orElseGet(java.util.function.Supplier<? extends T>)": function (s) { return this.v !== null ? this.v : call(s, "get", []); },
      "void ifPresent(java.util.function.Consumer<? super T>)": function (c) { if (this.v !== null) accept(c, this.v); },
      "void ifPresentOrElse(java.util.function.Consumer<? super T>,Runnable)": function (c, r) { if (this.v !== null) accept(c, this.v); else call(r, "run", []); },
      "<U> Optional<U> map(java.util.function.Function<? super T,? extends U>)": function (f) { return this.v === null ? this : mkOpt(apply(f, this.v)); },
      "<U> Optional<U> flatMap(java.util.function.Function<? super T,? extends Optional<? extends U>>)": function (f) { return this.v === null ? this : apply(f, this.v); },
      "Optional<T> filter(java.util.function.Predicate<? super T>)": function (p) { return this.v === null || test(p, this.v) ? this : mkOpt(null); },
      "Optional<T> or(java.util.function.Supplier<? extends Optional<? extends T>>)": function (s) { return this.v !== null ? this : call(s, "get", []); },
      "java.util.stream.Stream<T> stream()": function () { return J.mkStream(this.v === null ? [] : [this.v]); },
      "String toString()": function () { return jstr(this.v === null ? "Optional.empty" : "Optional[" + toStr(this.v) + "]"); },
      "boolean equals(Object)": function (o) { return o !== null && o.$c === this.$c && keyEq(this.v, o.v); },
      "int hashCode()": function () { return this.v === null ? 0 : jhash(this.v); }
    } });
    function primOpt(cls, name, fmt) {
      var m = {};
      m["static " + cls + " of(" + name + ")"] = function (v) { return { $c: L("java.util." + cls), v: v, has: true }; };
      m["static " + cls + " empty()"] = function () { return { $c: L("java.util." + cls), has: false }; };
      m["boolean isPresent()"] = function () { return this.has; };
      m["boolean isEmpty()"] = function () { return !this.has; };
      var getter = "getAs" + name[0].toUpperCase() + name.slice(1);
      m[name + " " + getter + "()"] = function () { if (!this.has) throwJ("java.util.NoSuchElementException", "No value present"); return this.v; };
      m[name + " orElseThrow()"] = function () { if (!this.has) throwJ("java.util.NoSuchElementException", "No value present"); return this.v; };
      m[name + " orElse(" + name + ")"] = function (d) { return this.has ? this.v : d; };
      m["void ifPresent(java.util.function." + (name === "int" ? "Int" : name === "double" ? "Double" : "Long") + "Consumer)"] = function (c) { if (this.has) call(c, "accept", [this.v]); };
      m["String toString()"] = function () { return jstr(this.has ? cls + "[" + fmt(this.v) + "]" : cls + ".empty"); };
      defLib("java.util." + cls, { flags: "public final", noCtor: true, m: m });
    }
    primOpt("OptionalInt", "int", String);
    primOpt("OptionalDouble", "double", I.doubleToString);
    primOpt("OptionalLong", "long", function (v) { return v.toString(); });
    function oInt(v) { return v === undefined ? { $c: L("java.util.OptionalInt"), has: false } : { $c: L("java.util.OptionalInt"), v: v, has: true }; }
    function oDbl(v) { return v === undefined ? { $c: L("java.util.OptionalDouble"), has: false } : { $c: L("java.util.OptionalDouble"), v: v, has: true }; }
    function oLong(v) { return v === undefined ? { $c: L("java.util.OptionalLong"), has: false } : { $c: L("java.util.OptionalLong"), v: v, has: true }; }

    // ---------- Streams (preguiçosos: puxam elemento por elemento) ----------
    // fonte: function() → iterador { next(): [true, valor] | null }
    function arrSrc(a) { return function () { var i = 0; return function () { return i < a.length ? [a[i++]] : null; }; }; }
    function mkS(cls, src, closeHandlers) { return { $c: L("java.util.stream." + cls), src: src, used: false }; }
    function mkStream(a) { return mkS("Stream", arrSrc(a)); }
    J.mkStream = mkStream;
    J.mkIntStream = function (a) { return mkS("IntStream", arrSrc(a)); };
    function pull(s, op) {
      if (s.used) throwJ("java.lang.IllegalStateException", "stream has already been operated upon or closed", ["java.base/java.util.stream.AbstractPipeline.evaluate(AbstractPipeline.java:260)", "java.base/java.util.stream.ReferencePipeline." + (op || "forEach") + "(ReferencePipeline.java:" + ({ count: 750, collect: 723, forEach: 636, toList: 741, reduce: 711 }[op || "forEach"] || 636) + ")"]);
      s.used = true;
      return s.src();
    }
    function drain(s) { var it = pull(s), r = [], x; while ((x = it())) r.push(x[0]); return r; }
    function derive(s, cls, mk) { var src = s; return mkS(cls, function () { return mk(pull(src)); }); }
    function mapOp(s, cls, f) { return derive(s, cls, function (it) { return function () { var x = it(); return x ? [f(x[0])] : null; }; }); }
    function filterOp(s, cls, p) { return derive(s, cls, function (it) { return function () { var x; while ((x = it())) if (p(x[0])) return x; return null; }; }); }
    function peekOp(s, cls, f) { return derive(s, cls, function (it) { return function () { var x = it(); if (x) f(x[0]); return x; }; }); }
    function limitOp(s, cls, n) { n = Number(n); if (n < 0) throwJ("java.lang.IllegalArgumentException", String(n)); return derive(s, cls, function (it) { var k = 0; return function () { if (k >= n) return null; k++; return it(); }; }); }
    function skipOp(s, cls, n) { n = Number(n); return derive(s, cls, function (it) { var k = 0; return function () { while (k < n) { if (!it()) return null; k++; } return it(); }; }); }
    function sortedOp(s, cls, c) { return derive(s, cls, function (it) { var a = null, i = 0; return function () { if (!a) { a = []; var x; while ((x = it())) a.push(x[0]); stableSort(a, c); } return i < a.length ? [a[i++]] : null; }; }); }
    function distinctOp(s, cls) { return derive(s, cls, function (it) { var seen = J.mkHashSet([], true); return function () { var x; while ((x = it())) { var k = x[0]; if (jcall(seen, "add", [k])) return x; } return null; }; }); }
    function flatOp(s, cls, f) { return derive(s, cls, function (it) { var cur = null; return function () { while (true) { if (cur) { var y = cur(); if (y) return y; cur = null; } var x = it(); if (!x) return null; var sub = f(x[0]); if (sub === null) continue; cur = pull(sub); } }; }); }
    function takeWhileOp(s, cls, p) { return derive(s, cls, function (it) { var done = false; return function () { if (done) return null; var x = it(); if (!x || !p(x[0])) { done = true; return null; } return x; }; }); }
    function dropWhileOp(s, cls, p) { return derive(s, cls, function (it) { var dropping = true; return function () { var x; while ((x = it())) { if (dropping && p(x[0])) continue; dropping = false; return x; } return null; }; }); }
    function findFirst(s) { var it = pull(s); return it(); }
    function anyMatch(s, p) { var it = pull(s), x; while ((x = it())) if (p(x[0])) return true; return false; }
    function allMatch(s, p) { var it = pull(s), x; while ((x = it())) if (!p(x[0])) return false; return true; }
    function forEach(s, f) { var it = pull(s), x; while ((x = it())) f(x[0]); }
    function iterate(seed, hasNext, next) { return function () { var cur, started = false, done = false; return function () { if (done) return null; if (!started) { started = true; cur = seed; } else cur = next(cur); if (hasNext && !hasNext(cur)) { done = true; return null; } return [cur]; }; }; }
    function generate(sup) { return function () { return function () { return [sup()]; }; }; }

    // ---------- Stream<T> ----------
    var SM = {
      "Stream<T> filter(java.util.function.Predicate<? super T>)": function (p) { return filterOp(this, "Stream", function (x) { return test(p, x); }); },
      "<R> Stream<R> map(java.util.function.Function<? super T,? extends R>)": function (f) { return mapOp(this, "Stream", function (x) { return apply(f, x); }); },
      "IntStream mapToInt(java.util.function.ToIntFunction<? super T>)": function (f) { return mapOp(this, "IntStream", function (x) { return call(f, "applyAsInt", [x]); }); },
      "LongStream mapToLong(java.util.function.ToLongFunction<? super T>)": function (f) { return mapOp(this, "LongStream", function (x) { return call(f, "applyAsLong", [x]); }); },
      "DoubleStream mapToDouble(java.util.function.ToDoubleFunction<? super T>)": function (f) { return mapOp(this, "DoubleStream", function (x) { return call(f, "applyAsDouble", [x]); }); },
      "<R> Stream<R> flatMap(java.util.function.Function<? super T,? extends Stream<? extends R>>)": function (f) { return flatOp(this, "Stream", function (x) { return apply(f, x); }); },
      "<R> Stream<R> mapMulti(java.util.function.BiConsumer<? super T,? super java.util.function.Consumer<R>>)": function (f) { return flatOp(this, "Stream", function (x) { var buf = []; call(f, "accept", [x, mkFn("Consumer", function (y) { buf.push(y); })]); return mkStream(buf); }); },
      "Stream<T> distinct()": function () { return distinctOp(this, "Stream"); },
      "Stream<T> sorted()": function () { return sortedOp(this, "Stream", null); },
      "Stream<T> sorted(java.util.Comparator<? super T>)": function (c) { return sortedOp(this, "Stream", c); },
      "Stream<T> peek(java.util.function.Consumer<? super T>)": function (c) { return peekOp(this, "Stream", function (x) { accept(c, x); }); },
      "Stream<T> limit(long)": function (n) { return limitOp(this, "Stream", n); },
      "Stream<T> skip(long)": function (n) { return skipOp(this, "Stream", n); },
      "Stream<T> takeWhile(java.util.function.Predicate<? super T>)": function (p) { return takeWhileOp(this, "Stream", function (x) { return test(p, x); }); },
      "Stream<T> dropWhile(java.util.function.Predicate<? super T>)": function (p) { return dropWhileOp(this, "Stream", function (x) { return test(p, x); }); },
      "void forEach(java.util.function.Consumer<? super T>)": function (c) { forEach(this, function (x) { accept(c, x); }); },
      "void forEachOrdered(java.util.function.Consumer<? super T>)": function (c) { forEach(this, function (x) { accept(c, x); }); },
      "Object[] toArray()": function () { var a = drain(this), r = newArray(OBJ(), a.length); a.forEach(function (x, i) { r.a[i] = x; }); return r; },
      "<A> A[] toArray(java.util.function.IntFunction<A[]>)": function (g) { var a = drain(this), r = call(g, "apply", [a.length]); a.forEach(function (x, i) { r.a[i] = x; }); return r; },
      "T reduce(T,java.util.function.BinaryOperator<T>)": function (id, op) { var acc = id; forEach(this, function (x) { acc = call(op, "apply", [acc, x]); }); return acc; },
      "Optional<T> reduce(java.util.function.BinaryOperator<T>)": function (op) { var acc, has = false; forEach(this, function (x) { if (!has) { acc = x; has = true; } else acc = call(op, "apply", [acc, x]); }); return mkOpt(has ? acc : null); },
      "<U> U reduce(U,java.util.function.BiFunction<U,? super T,U>,java.util.function.BinaryOperator<U>)": function (id, f) { var acc = id; forEach(this, function (x) { acc = call(f, "apply", [acc, x]); }); return acc; },
      "<R,A> R collect(Collector<? super T,A,R>)": function (c) { var col = c.col; var acc = col.sup(); forEach(this, function (x) { col.acc(acc, x); }); return col.fin ? col.fin(acc) : acc; },
      "<R> R collect(java.util.function.Supplier<R>,java.util.function.BiConsumer<R,? super T>,java.util.function.BiConsumer<R,R>)": function (s, a) { var r = call(s, "get", []); forEach(this, function (x) { call(a, "accept", [r, x]); }); return r; },
      "List<T> toList()": function () { return mkList(drain(this), "java.util.ImmutableList", { imm: true }); },
      "Optional<T> min(java.util.Comparator<? super T>)": function (c) { var best, has = false; forEach(this, function (x) { if (!has || cmp(c, x, best) < 0) { best = x; has = true; } }); return mkOpt(has ? best : null); },
      "Optional<T> max(java.util.Comparator<? super T>)": function (c) { var best, has = false; forEach(this, function (x) { if (!has || cmp(c, x, best) > 0) { best = x; has = true; } }); return mkOpt(has ? best : null); },
      "long count()": function () { var it = pull(this, "count"), n = 0; while (it()) n++; return BigInt(n); },
      "boolean anyMatch(java.util.function.Predicate<? super T>)": function (p) { return anyMatch(this, function (x) { return test(p, x); }); },
      "boolean allMatch(java.util.function.Predicate<? super T>)": function (p) { return allMatch(this, function (x) { return test(p, x); }); },
      "boolean noneMatch(java.util.function.Predicate<? super T>)": function (p) { return !anyMatch(this, function (x) { return test(p, x); }); },
      "Optional<T> findFirst()": function () { var x = findFirst(this); if (x && x[0] === null) npe(); return mkOpt(x ? x[0] : null); },
      "Optional<T> findAny()": function () { var x = findFirst(this); return mkOpt(x ? x[0] : null); },
      "Iterator<T> iterator()": function () { var a = drain(this); return jcall(mkList(a), "iterator", []); },
      "Stream<T> parallel()": function () { return this; }, "Stream<T> sequential()": function () { return this; }, "Stream<T> unordered()": function () { return this; },
      "boolean isParallel()": function () { return false; },
      "void close()": function () {},
      "Stream<T> onClose(Runnable)": function () { return this; },
      "static <T> Stream<T> of(T...)": function (a) { return mkStream(Array.from(a.a)); },
      "static <T> Stream<T> of(T)": function (a) { return mkStream([a]); },
      "static <T> Stream<T> empty()": function () { return mkStream([]); },
      "static <T> Stream<T> ofNullable(T)": function (a) { return mkStream(a === null ? [] : [a]); },
      "static <T> Stream<T> iterate(T,java.util.function.UnaryOperator<T>)": function (s, f) { return mkS("Stream", iterate(s, null, function (x) { return apply(f, x); })); },
      "static <T> Stream<T> iterate(T,java.util.function.Predicate<? super T>,java.util.function.UnaryOperator<T>)": function (s, p, f) { return mkS("Stream", iterate(s, function (x) { return test(p, x); }, function (x) { return apply(f, x); })); },
      "static <T> Stream<T> generate(java.util.function.Supplier<? extends T>)": function (g) { return mkS("Stream", generate(function () { return call(g, "get", []); })); },
      "static <T> Stream<T> concat(Stream<? extends T>,Stream<? extends T>)": function (a, b) { return mkS("Stream", function () { var ia = pull(a), ib = null; return function () { var x = ia(); if (x) return x; if (!ib) ib = pull(b); return ib(); }; }); }
    };
    defLib("java.util.stream.BaseStream", { kind: "interface", tp: "T,S", impl: ["AutoCloseable"], m: { "void close()": null } });
    defLib("java.util.stream.Stream", { kind: "interface", tp: "T", impl: ["java.util.stream.BaseStream<T,Stream<T>>"], m: SM, bin: "java.util.stream.ReferencePipeline$Head" });
    // os streams são objetos da própria interface (implementação embutida)
    L("java.util.stream.Stream").lib.spec.kind = "interface";
    // IntStream / LongStream / DoubleStream
    function numStream(cls, prim, boxN, optFn) {
      var isD = prim === "double", isL = prim === "long";
      var zero = isL ? 0n : 0;
      function add(a, b) { return isL ? BigInt.asIntN(64, a + b) : isD ? a + b : (a + b) | 0; }
      var fnPre = { "int": "Int", "long": "Long", "double": "Double" }[prim];
      var m = {};
      m[cls + " filter(java.util.function." + fnPre + "Predicate)"] = function (p) { return filterOp(this, cls, function (x) { return call(p, "test", [x]); }); };
      m[cls + " map(java.util.function." + fnPre + "UnaryOperator)"] = function (f) { return mapOp(this, cls, function (x) { return call(f, isD ? "applyAsDouble" : isL ? "applyAsLong" : "applyAsInt", [x]); }); };
      m["<U> Stream<U> mapToObj(java.util.function." + fnPre + "Function<? extends U>)"] = function (f) { return mapOp(this, "Stream", function (x) { return call(f, "apply", [x]); }); };
      m["Stream<" + boxN + "> boxed()"] = function () { return mapOp(this, "Stream", function (x) { return box(prim, x); }); };
      if (!isD) m["DoubleStream asDoubleStream()"] = function () { return mapOp(this, "DoubleStream", function (x) { return Number(x); }); };
      if (prim === "int") {
        m["LongStream asLongStream()"] = function () { return mapOp(this, "LongStream", function (x) { return BigInt(x); }); };
        m["DoubleStream mapToDouble(java.util.function.IntToDoubleFunction)"] = function (f) { return mapOp(this, "DoubleStream", function (x) { return call(f, "applyAsDouble", [x]); }); };
        m["LongStream mapToLong(java.util.function.IntToLongFunction)"] = function (f) { return mapOp(this, "LongStream", function (x) { return call(f, "applyAsLong", [x]); }); };
        m["IntStream flatMap(java.util.function.IntFunction<? extends IntStream>)"] = function (f) { return flatOp(this, "IntStream", function (x) { return call(f, "apply", [x]); }); };
      }
      if (isD) m["IntStream mapToInt(java.util.function.DoubleToIntFunction)"] = function (f) { return mapOp(this, "IntStream", function (x) { return call(f, "applyAsInt", [x]); }); };
      m[cls + " sorted()"] = function () { return sortedOp(this, cls, J.mkComparator(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; })); };
      m[cls + " distinct()"] = function () { return derive(this, cls, function (it) { var seen = []; return function () { var x; while ((x = it())) { if (seen.indexOf(x[0]) < 0) { seen.push(x[0]); return x; } } return null; }; }); };
      m[cls + " limit(long)"] = function (n) { return limitOp(this, cls, n); };
      m[cls + " skip(long)"] = function (n) { return skipOp(this, cls, n); };
      m[cls + " peek(java.util.function." + fnPre + "Consumer)"] = function (c) { return peekOp(this, cls, function (x) { call(c, "accept", [x]); }); };
      m[cls + " takeWhile(java.util.function." + fnPre + "Predicate)"] = function (p) { return takeWhileOp(this, cls, function (x) { return call(p, "test", [x]); }); };
      m["void forEach(java.util.function." + fnPre + "Consumer)"] = function (c) { forEach(this, function (x) { call(c, "accept", [x]); }); };
      m["void forEachOrdered(java.util.function." + fnPre + "Consumer)"] = function (c) { forEach(this, function (x) { call(c, "accept", [x]); }); };
      m[prim + " sum()"] = function () { var s = zero; if (isD) { var vals = drain(this); return kahanSum(vals); } forEach(this, function (x) { s = add(s, x); }); return s; };
      m["OptionalDouble average()"] = function () { var a = drain(this); if (!a.length) return oDbl(); if (isD) return oDbl(kahanSum(a) / a.length); var s = 0n; a.forEach(function (x) { s += BigInt(x); }); return oDbl(Number(s) / a.length); };
      m[optFn + " min()"] = function () { var a = drain(this); if (!a.length) return mkPOpt(); var b = a[0]; a.forEach(function (x) { if (isD ? (x < b || (x !== x)) : x < b) b = x; }); return mkPOpt(b); };
      m[optFn + " max()"] = function () { var a = drain(this); if (!a.length) return mkPOpt(); var b = a[0]; a.forEach(function (x) { if (x > b) b = x; }); return mkPOpt(b); };
      m["long count()"] = function () { return BigInt(drain(this).length); };
      m[prim + " reduce(" + prim + ",java.util.function." + fnPre + "BinaryOperator)"] = function (id, op) { var acc = id; forEach(this, function (x) { acc = call(op, isD ? "applyAsDouble" : isL ? "applyAsLong" : "applyAsInt", [acc, x]); }); return acc; };
      m[optFn + " reduce(java.util.function." + fnPre + "BinaryOperator)"] = function (op) { var acc, has = false; forEach(this, function (x) { if (!has) { acc = x; has = true; } else acc = call(op, isD ? "applyAsDouble" : isL ? "applyAsLong" : "applyAsInt", [acc, x]); }); return has ? mkPOpt(acc) : mkPOpt(); };
      m["boolean anyMatch(java.util.function." + fnPre + "Predicate)"] = function (p) { return anyMatch(this, function (x) { return call(p, "test", [x]); }); };
      m["boolean allMatch(java.util.function." + fnPre + "Predicate)"] = function (p) { return allMatch(this, function (x) { return call(p, "test", [x]); }); };
      m["boolean noneMatch(java.util.function." + fnPre + "Predicate)"] = function (p) { return !anyMatch(this, function (x) { return call(p, "test", [x]); }); };
      m[optFn + " findFirst()"] = function () { var x = findFirst(this); return x ? mkPOpt(x[0]) : mkPOpt(); };
      m[optFn + " findAny()"] = function () { var x = findFirst(this); return x ? mkPOpt(x[0]) : mkPOpt(); };
      m[prim + "[] toArray()"] = function () { var a = drain(this), r = newArray(T[prim], a.length); a.forEach(function (x, i) { r.a[i] = x; }); return r; };
      m[fnPre + "SummaryStatistics summaryStatistics()"] = function () { var st = mkStats(fnPre); var self = this; forEach(this, function (x) { statAdd(st, x); }); return st; };
      m["<R> R collect(java.util.function.Supplier<R>,java.util.function.Obj" + fnPre + "Consumer<R>,java.util.function.BiConsumer<R,R>)"] = function (s, a) { var r = call(s, "get", []); forEach(this, function (x) { call(a, "accept", [r, x]); }); return r; };
      m[cls + " parallel()"] = function () { return this; };
      m[cls + " sequential()"] = function () { return this; };
      m["Iterator<" + boxN + "> iterator()"] = function () { return jcall(mkList(drain(this).map(function (x) { return box(prim, x); })), "iterator", []); };
      m["static " + cls + " of(" + prim + "...)"] = function (a) { return mkS(cls, arrSrc(Array.from(a.a))); };
      m["static " + cls + " empty()"] = function () { return mkS(cls, arrSrc([])); };
      m["static " + cls + " iterate(" + prim + ",java.util.function." + fnPre + "UnaryOperator)"] = function (s, f) { return mkS(cls, iterate(s, null, function (x) { return call(f, isD ? "applyAsDouble" : isL ? "applyAsLong" : "applyAsInt", [x]); })); };
      m["static " + cls + " iterate(" + prim + ",java.util.function." + fnPre + "Predicate,java.util.function." + fnPre + "UnaryOperator)"] = function (s, p, f) { return mkS(cls, iterate(s, function (x) { return call(p, "test", [x]); }, function (x) { return call(f, isD ? "applyAsDouble" : isL ? "applyAsLong" : "applyAsInt", [x]); })); };
      m["static " + cls + " generate(java.util.function." + fnPre + "Supplier)"] = function (g) { return mkS(cls, generate(function () { return call(g, isD ? "getAsDouble" : isL ? "getAsLong" : "getAsInt", []); })); };
      if (!isD) {
        m["static " + cls + " range(" + prim + "," + prim + ")"] = function (a, b) { return mkS(cls, function () { var i = a; return function () { if (i < b) { var v = i; i = isL ? i + 1n : i + 1; return [v]; } return null; }; }); };
        m["static " + cls + " rangeClosed(" + prim + "," + prim + ")"] = function (a, b) { return mkS(cls, function () { var i = a, done = a > b; return function () { if (done) return null; var v = i; if (i === b) done = true; else i = isL ? i + 1n : i + 1; return [v]; }; }); };
      }
      m["static " + cls + " concat(" + cls + "," + cls + ")"] = function (a, b) { return mkS(cls, function () { var ia = pull(a), ib = null; return function () { var x = ia(); if (x) return x; if (!ib) ib = pull(b); return ib(); }; }); };
      function mkPOpt(v) { return prim === "int" ? oInt(v) : prim === "long" ? oLong(v) : oDbl(v); }
      defLib("java.util.stream." + cls, { kind: "interface", impl: ["java.util.stream.BaseStream<" + boxN + "," + cls + ">"], m: m, bin: "java.util.stream." + (prim === "int" ? "Int" : prim === "long" ? "Long" : "Double") + "Pipeline$Head" });
    }
    function kahanSum(a) {
      // DoubleStream.sum usa soma compensada (Kahan)
      var sum = 0, c = 0, simple = 0;
      for (var i = 0; i < a.length; i++) { simple += a[i]; var y = a[i] - c; var t = sum + y; c = (t - sum) - y; sum = t; }
      if (sum !== sum && simple === Infinity) return simple;
      return sum;
    }
    numStream("IntStream", "int", "Integer", "OptionalInt");
    numStream("LongStream", "long", "Long", "OptionalLong");
    numStream("DoubleStream", "double", "Double", "OptionalDouble");
    // estatísticas (toString usa String.format → vírgula no pt_BR)
    function mkStats(kind) { return { $c: L("java.util." + kind + "SummaryStatistics"), n: 0, sum: kind === "Long" ? 0n : 0, min: kind === "Int" ? 2147483647 : kind === "Long" ? 9223372036854775807n : Infinity, max: kind === "Int" ? -2147483648 : kind === "Long" ? -9223372036854775808n : -Infinity, kind: kind }; }
    function statAdd(st, x) { st.n++; if (st.kind === "Long") { st.sum += BigInt(x); } else if (st.kind === "Int") { st.sum += x; } else { st.sum += x; } if (x < st.min) st.min = x; if (x > st.max) st.max = x; }
    J.mkStats = mkStats; J.statAdd = statAdd;
    ["Int", "Long", "Double"].forEach(function (k) {
      var p = k.toLowerCase();
      var m = {
        "<init>()": function () { var s = mkStats(k); for (var q in s) this[q] = s[q]; },
        "void accept(int)": function (x) { statAdd(this, k === "Long" ? BigInt(x) : x); },
        "long getCount()": function () { return BigInt(this.n); },
        "double getAverage()": function () { return this.n ? Number(this.sum) / this.n : 0; },
        "String toString()": function () {
          var avg = this.n ? Number(this.sum) / this.n : 0;
          var fmt = function (v) { return I.jformat(k === "Double" ? "%f" : "%d", [boxVal(k === "Double" ? "double" : k === "Long" ? "long" : "int", v)]); };
          var sumS = k === "Double" ? I.jformat("%f", [boxVal("double", this.sum)]) : I.jformat("%d", [boxVal("long", BigInt(this.sum))]);
          return jstr(k + "SummaryStatistics{count=" + this.n + ", sum=" + sumS + ", min=" + fmt(this.min) + ", average=" + I.jformat("%f", [boxVal("double", avg)]) + ", max=" + fmt(this.max) + "}");
        }
      };
      m[(k === "Int" ? "long" : p) + " getSum()"] = function () { return k === "Int" ? BigInt(this.sum) : this.sum; };
      m[p + " getMin()"] = function () { return this.min; };
      m[p + " getMax()"] = function () { return this.max; };
      if (k !== "Int") m["void accept(" + p + ")"] = function (x) { statAdd(this, x); };
      defLib("java.util." + k + "SummaryStatistics", { m: m });
    });

    // ---------- Collectors ----------
    defLib("java.util.stream.Collector", { kind: "interface", tp: "T,A,R", m: {} });
    function mkCol(sup, acc, fin) { return { $c: L("java.util.stream.CollectorImpl"), col: { sup: sup, acc: acc, fin: fin } }; }
    defLib("java.util.stream.CollectorImpl", { tp: "T,A,R", impl: ["Collector<T,A,R>"], bin: "java.util.stream.Collectors$CollectorImpl", m: {} });
    function runCol(c, arr) { var a = c.col.sup(); arr.forEach(function (x) { c.col.acc(a, x); }); return c.col.fin ? c.col.fin(a) : a; }
    function newMap(supplier) { if (supplier) return call(supplier, "get", []); return I.newLib("java.util.HashMap"); }
    function groupCol(keyF, mapSup, down) {
      down = down || null;
      return mkCol(function () { return { m: newMap(mapSup), groups: [] }; }, function (st, x) {
        var k = apply(keyF, x);
        if (k === null) throwJ("java.lang.NullPointerException", "element cannot be mapped to a null key");
        var g = jcall(st.m, "get", [k]);
        if (g === null) { g = { v: down ? down.col.sup() : [] }; jcall(st.m, "computeIfAbsent", [k, mkFn("Function", function () { return g; })]); st.groups.push([k, g]); }
        if (down) down.col.acc(g.v, x); else g.v.push(x);
      }, function (st) {
        J.mapEntries(st.m).forEach(function (e) { var g = e.value; e.value = down ? (down.col.fin ? down.col.fin(g.v) : g.v) : mkList(g.v); });
        return st.m;
      });
    }
    defLib("java.util.stream.Collectors", { flags: "public final", noCtor: true, m: {
      "static <T> Collector<T,?,List<T>> toList()": function () { return mkCol(function () { return []; }, function (a, x) { a.push(x); }, function (a) { return mkList(a); }); },
      "static <T> Collector<T,?,List<T>> toUnmodifiableList()": function () { return mkCol(function () { return []; }, function (a, x) { if (x === null) npe(); a.push(x); }, function (a) { return mkList(a, "java.util.ImmutableList", { imm: true }); }); },
      "static <T> Collector<T,?,Set<T>> toSet()": function () { return mkCol(function () { return J.mkHashSet([]); }, function (s, x) { jcall(s, "add", [x]); }); },
      "static <T> Collector<T,?,Set<T>> toUnmodifiableSet()": function () { return mkCol(function () { return J.mkHashSet([]); }, function (s, x) { jcall(s, "add", [x]); }); },
      "static <T,C extends Collection<T>> Collector<T,?,C> toCollection(java.util.function.Supplier<C>)": function (s) { return mkCol(function () { return call(s, "get", []); }, function (c, x) { jcall(c, "add", [x]); }); },
      "static Collector<CharSequence,?,String> joining()": function () { return mkCol(function () { return []; }, function (a, x) { a.push(toStr(x)); }, function (a) { return jstr(a.join("")); }); },
      "static Collector<CharSequence,?,String> joining(CharSequence)": function (d) { return mkCol(function () { return []; }, function (a, x) { a.push(toStr(x)); }, function (a) { return jstr(a.join(toStr(d))); }); },
      "static Collector<CharSequence,?,String> joining(CharSequence,CharSequence,CharSequence)": function (d, p, s) { return mkCol(function () { return []; }, function (a, x) { a.push(toStr(x)); }, function (a) { return jstr(toStr(p) + a.join(toStr(d)) + toStr(s)); }); },
      "static <T> Collector<T,?,Long> counting()": function () { return mkCol(function () { return { n: 0n }; }, function (a) { a.n++; }, function (a) { return box("long", a.n); }); },
      "static <T> Collector<T,?,Integer> summingInt(java.util.function.ToIntFunction<? super T>)": function (f) { return mkCol(function () { return { s: 0 }; }, function (a, x) { a.s = (a.s + call(f, "applyAsInt", [x])) | 0; }, function (a) { return box("int", a.s); }); },
      "static <T> Collector<T,?,Long> summingLong(java.util.function.ToLongFunction<? super T>)": function (f) { return mkCol(function () { return { s: 0n }; }, function (a, x) { a.s += call(f, "applyAsLong", [x]); }, function (a) { return box("long", a.s); }); },
      "static <T> Collector<T,?,Double> summingDouble(java.util.function.ToDoubleFunction<? super T>)": function (f) { return mkCol(function () { return []; }, function (a, x) { a.push(call(f, "applyAsDouble", [x])); }, function (a) { return box("double", kahanSum(a)); }); },
      "static <T> Collector<T,?,Double> averagingInt(java.util.function.ToIntFunction<? super T>)": function (f) { return mkCol(function () { return { s: 0n, n: 0 }; }, function (a, x) { a.s += BigInt(call(f, "applyAsInt", [x])); a.n++; }, function (a) { return box("double", a.n ? Number(a.s) / a.n : 0); }); },
      "static <T> Collector<T,?,Double> averagingLong(java.util.function.ToLongFunction<? super T>)": function (f) { return mkCol(function () { return { s: 0n, n: 0 }; }, function (a, x) { a.s += call(f, "applyAsLong", [x]); a.n++; }, function (a) { return box("double", a.n ? Number(a.s) / a.n : 0); }); },
      "static <T> Collector<T,?,Double> averagingDouble(java.util.function.ToDoubleFunction<? super T>)": function (f) { return mkCol(function () { return []; }, function (a, x) { a.push(call(f, "applyAsDouble", [x])); }, function (a) { return box("double", a.length ? kahanSum(a) / a.length : 0); }); },
      "static <T> Collector<T,?,IntSummaryStatistics> summarizingInt(java.util.function.ToIntFunction<? super T>)": function (f) { return mkCol(function () { return mkStats("Int"); }, function (s, x) { statAdd(s, call(f, "applyAsInt", [x])); }); },
      "static <T> Collector<T,?,DoubleSummaryStatistics> summarizingDouble(java.util.function.ToDoubleFunction<? super T>)": function (f) { return mkCol(function () { return mkStats("Double"); }, function (s, x) { statAdd(s, call(f, "applyAsDouble", [x])); }); },
      "static <T> Collector<T,?,LongSummaryStatistics> summarizingLong(java.util.function.ToLongFunction<? super T>)": function (f) { return mkCol(function () { return mkStats("Long"); }, function (s, x) { statAdd(s, call(f, "applyAsLong", [x])); }); },
      "static <T> Collector<T,?,Optional<T>> minBy(java.util.Comparator<? super T>)": function (c) { return mkCol(function () { return { has: false }; }, function (a, x) { if (!a.has || cmp(c, x, a.v) < 0) { a.v = x; a.has = true; } }, function (a) { return jcall({ $c: L("java.util.Optional") }, "toString", []) && { $c: L("java.util.Optional"), v: a.has ? a.v : null }; }); },
      "static <T> Collector<T,?,Optional<T>> maxBy(java.util.Comparator<? super T>)": function (c) { return mkCol(function () { return { has: false }; }, function (a, x) { if (!a.has || cmp(c, x, a.v) > 0) { a.v = x; a.has = true; } }, function (a) { return { $c: L("java.util.Optional"), v: a.has ? a.v : null }; }); },
      "static <T,U,A,R> Collector<T,?,R> mapping(java.util.function.Function<? super T,? extends U>,Collector<? super U,A,R>)": function (f, d) { return mkCol(d.col.sup, function (a, x) { d.col.acc(a, apply(f, x)); }, d.col.fin); },
      "static <T,A,R> Collector<T,?,R> filtering(java.util.function.Predicate<? super T>,Collector<? super T,A,R>)": function (p, d) { return mkCol(d.col.sup, function (a, x) { if (test(p, x)) d.col.acc(a, x); }, d.col.fin); },
      "static <T,U,A,R> Collector<T,?,R> flatMapping(java.util.function.Function<? super T,? extends java.util.stream.Stream<? extends U>>,Collector<? super U,A,R>)": function (f, d) { return mkCol(d.col.sup, function (a, x) { drain(apply(f, x)).forEach(function (y) { d.col.acc(a, y); }); }, d.col.fin); },
      "static <T,A,R,RR> Collector<T,A,RR> collectingAndThen(Collector<T,A,R>,java.util.function.Function<R,RR>)": function (d, f) { return mkCol(d.col.sup, d.col.acc, function (a) { return apply(f, d.col.fin ? d.col.fin(a) : a); }); },
      "static <T> Collector<T,?,Optional<T>> reducing(java.util.function.BinaryOperator<T>)": function (op) { return mkCol(function () { return { has: false }; }, function (a, x) { if (!a.has) { a.v = x; a.has = true; } else a.v = call(op, "apply", [a.v, x]); }, function (a) { return { $c: L("java.util.Optional"), v: a.has ? a.v : null }; }); },
      "static <T> Collector<T,?,T> reducing(T,java.util.function.BinaryOperator<T>)": function (id, op) { return mkCol(function () { return { v: id }; }, function (a, x) { a.v = call(op, "apply", [a.v, x]); }, function (a) { return a.v; }); },
      "static <T,K> Collector<T,?,Map<K,List<T>>> groupingBy(java.util.function.Function<? super T,? extends K>)": function (f) { return groupCol(f, null, null); },
      "static <T,K,A,D> Collector<T,?,Map<K,D>> groupingBy(java.util.function.Function<? super T,? extends K>,Collector<? super T,A,D>)": function (f, d) { return groupCol(f, null, d); },
      "static <T,K,D,A,M extends Map<K,D>> Collector<T,?,M> groupingBy(java.util.function.Function<? super T,? extends K>,java.util.function.Supplier<M>,Collector<? super T,A,D>)": function (f, s, d) { return groupCol(f, s, d); },
      "static <T> Collector<T,?,Map<Boolean,List<T>>> partitioningBy(java.util.function.Predicate<? super T>)": function (p) { return partCol(p, null); },
      "static <T,D,A> Collector<T,?,Map<Boolean,D>> partitioningBy(java.util.function.Predicate<? super T>,Collector<? super T,A,D>)": function (p, d) { return partCol(p, d); },
      "static <T,K,U> Collector<T,?,Map<K,U>> toMap(java.util.function.Function<? super T,? extends K>,java.util.function.Function<? super T,? extends U>)": function (kf, vf) {
        return mkCol(function () { return newMap(null); }, function (m, x) {
          var k = apply(kf, x), v = apply(vf, x);
          if (v === null) npe();
          if (jcall(m, "containsKey", [k])) throwJ("java.lang.IllegalStateException", "Duplicate key " + toStr(k) + " (attempted merging values " + toStr(jcall(m, "get", [k])) + " and " + toStr(v) + ")", ["java.base/java.util.stream.Collectors.duplicateKeyException(Collectors.java:135)", "java.base/java.util.stream.Collectors.lambda$uniqKeysMapAccumulator$0(Collectors.java:182)", "java.base/java.util.stream.ReduceOps$3ReducingSink.accept(ReduceOps.java:169)", "java.base/java.util.Spliterators$ArraySpliterator.forEachRemaining(Spliterators.java:1024)", "java.base/java.util.stream.AbstractPipeline.copyInto(AbstractPipeline.java:570)", "java.base/java.util.stream.AbstractPipeline.wrapAndCopyInto(AbstractPipeline.java:560)", "java.base/java.util.stream.ReduceOps$ReduceOp.evaluateSequential(ReduceOps.java:921)", "java.base/java.util.stream.AbstractPipeline.evaluate(AbstractPipeline.java:265)", "java.base/java.util.stream.ReferencePipeline.collect(ReferencePipeline.java:723)"]);
          jcall(m, "put", [k, v]);
        });
      },
      "static <T,K,U> Collector<T,?,Map<K,U>> toMap(java.util.function.Function<? super T,? extends K>,java.util.function.Function<? super T,? extends U>,java.util.function.BinaryOperator<U>)": function (kf, vf, mg) { return mkCol(function () { return newMap(null); }, function (m, x) { jcall(m, "merge", [apply(kf, x), apply(vf, x), mg]); }); },
      "static <T,K,U,M extends Map<K,U>> Collector<T,?,M> toMap(java.util.function.Function<? super T,? extends K>,java.util.function.Function<? super T,? extends U>,java.util.function.BinaryOperator<U>,java.util.function.Supplier<M>)": function (kf, vf, mg, s) { return mkCol(function () { return call(s, "get", []); }, function (m, x) { jcall(m, "merge", [apply(kf, x), apply(vf, x), mg]); }); },
      "static <T,R1,R2,R> Collector<T,?,R> teeing(Collector<? super T,?,R1>,Collector<? super T,?,R2>,java.util.function.BiFunction<? super R1,? super R2,R>)": function (c1, c2, f) { return mkCol(function () { return [c1.col.sup(), c2.col.sup()]; }, function (a, x) { c1.col.acc(a[0], x); c2.col.acc(a[1], x); }, function (a) { return call(f, "apply", [c1.col.fin ? c1.col.fin(a[0]) : a[0], c2.col.fin ? c2.col.fin(a[1]) : a[1]]); }); }
    } });
    function partCol(p, d) {
      return mkCol(function () { return { f: d ? d.col.sup() : [], t: d ? d.col.sup() : [] }; }, function (a, x) { var k = test(p, x) ? "t" : "f"; if (d) d.col.acc(a[k], x); else a[k].push(x); }, function (a) {
        var m = I.newLib("java.util.LinkedHashMap");
        var fv = d ? (d.col.fin ? d.col.fin(a.f) : a.f) : mkList(a.f), tv = d ? (d.col.fin ? d.col.fin(a.t) : a.t) : mkList(a.t);
        jcall(m, "put", [boxVal("boolean", false), fv]); jcall(m, "put", [boxVal("boolean", true), tv]);
        m.$c = L("java.util.PartitionMap");
        return m;
      });
    }
    defLib("java.util.PartitionMap", { tp: "K,V", ext: "java.util.LinkedHashMap<K,V>", bin: "java.util.stream.Collectors$Partition", m: {} });
    defLib("java.util.stream.StreamSupport", { flags: "public final", noCtor: true, m: {} });

    // ---------- Collections ----------
    function listArr(l) { if (l === null) npe(); return l.a !== undefined ? l.a : null; }
    defLib("java.util.Collections", { flags: "public final", noCtor: true, m: {
      "static <T extends Comparable<? super T>> void sort(List<T>)": function (l) { var a = listArr(l); if (a) { if (l.imm) I.throwJ("java.lang.UnsupportedOperationException", null); stableSort(a, null); l.mod++; } else jcall(l, "sort", [null]); },
      "static <T> void sort(List<T>,java.util.Comparator<? super T>)": function (l, c) { var a = listArr(l); if (a) { stableSort(a, c); l.mod++; } else jcall(l, "sort", [c]); },
      "static void reverse(List<?>)": function (l) { var a = listArr(l); if (l.imm) I.throwJ("java.lang.UnsupportedOperationException", null); a.reverse(); },
      "static void shuffle(List<?>)": function (l) { shuffle(l, new I.JRandom(RT().nextSeed())); },
      "static void shuffle(List<?>,Random)": function (l, r) { shuffle(l, r.r); },
      "static void swap(List<?>,int,int)": function (l, i, j) { var a = listArr(l); if (i < 0 || i >= a.length || j < 0 || j >= a.length) throwJ("java.lang.IndexOutOfBoundsException", "Index " + (i < 0 || i >= a.length ? i : j) + " out of bounds for length " + a.length); var t = a[i]; a[i] = a[j]; a[j] = t; },
      "static <T extends Object & Comparable<? super T>> T max(Collection<? extends T>)": function (c) { var a = toArr(c); if (!a.length) throwJ("java.util.NoSuchElementException", null, ["java.base/java.util.ArrayList$Itr.next(ArrayList.java:1053)", "java.base/java.util.Collections.max(Collections.java:698)"]); var b = a[0]; a.forEach(function (x) { if (jcompare(x, b) > 0) b = x; }); return b; },
      "static <T extends Object & Comparable<? super T>> T min(Collection<? extends T>)": function (c) { var a = toArr(c); if (!a.length) throwJ("java.util.NoSuchElementException", null, ["java.base/java.util.ArrayList$Itr.next(ArrayList.java:1053)", "java.base/java.util.Collections.min(Collections.java:600)"]); var b = a[0]; a.forEach(function (x) { if (jcompare(x, b) < 0) b = x; }); return b; },
      "static <T> T max(Collection<? extends T>,java.util.Comparator<? super T>)": function (c, k) { var a = toArr(c); if (!a.length) throwJ("java.util.NoSuchElementException", null); var b = a[0]; a.forEach(function (x) { if (cmp(k, x, b) > 0) b = x; }); return b; },
      "static <T> T min(Collection<? extends T>,java.util.Comparator<? super T>)": function (c, k) { var a = toArr(c); if (!a.length) throwJ("java.util.NoSuchElementException", null); var b = a[0]; a.forEach(function (x) { if (cmp(k, x, b) < 0) b = x; }); return b; },
      "static int frequency(Collection<?>,Object)": function (c, o) { return toArr(c).filter(function (x) { return keyEq(x, o); }).length; },
      "static <T> List<T> emptyList()": function () { return mkList([], "java.util.ImmutableList", { imm: true }); },
      "static <T> Set<T> emptySet()": function () { return jcall(null, "x", []); },
      "static <K,V> Map<K,V> emptyMap()": function () { return L("java.util.Map").methods.of.filter(function (m) { return !m.params.length; })[0].impl(); },
      "static <T> List<T> singletonList(T)": function (x) { return mkList([x], "java.util.ImmutableList", { imm: true }); },
      "static <T> Set<T> singleton(T)": function (x) { var s = J.mkHashSet([x]); s.imm = true; return s; },
      "static <T> List<T> nCopies(int,T)": function (n, x) { var a = []; for (var i = 0; i < n; i++) a.push(x); return mkList(a, "java.util.ImmutableList", { imm: true }); },
      "static <T> List<T> unmodifiableList(List<? extends T>)": function (l) { return mkList(toArr(l), "java.util.ImmutableList", { imm: true }); },
      "static <T> Set<T> unmodifiableSet(Set<? extends T>)": function (s) { var r = J.mkHashSet(toArr(s), true); r.imm = true; return r; },
      "static <K,V> Map<K,V> unmodifiableMap(Map<? extends K,? extends V>)": function (m) { return m; },
      "static <T> List<T> synchronizedList(List<T>)": function (l) { return l; },
      "static <K,V> Map<K,V> synchronizedMap(Map<K,V>)": function (m) { return m; },
      "static <T> boolean addAll(Collection<? super T>,T...)": function (c, a) { var ch = false; a.a.forEach(function (x) { if (jcall(c, "add", [x])) ch = true; }); return ch; },
      "static <T> java.util.Comparator<T> reverseOrder()": function () { return J.mkComparator(function (a, b) { return jcompare(b, a); }); },
      "static <T> java.util.Comparator<T> reverseOrder(java.util.Comparator<T>)": function (c) { return J.mkComparator(function (a, b) { return cmp(c, b, a); }); },
      "static <T> int binarySearch(List<? extends Comparable<? super T>>,T)": function (l, k) { var a = toArr(l), lo = 0, hi = a.length - 1; while (lo <= hi) { var mid = (lo + hi) >>> 1, c = jcompare(a[mid], k); if (c < 0) lo = mid + 1; else if (c > 0) hi = mid - 1; else return mid; } return -(lo + 1); },
      "static <T> void fill(List<? super T>,T)": function (l, x) { var a = listArr(l); for (var i = 0; i < a.length; i++) a[i] = x; },
      "static void rotate(List<?>,int)": function (l, d) { var a = listArr(l), n = a.length; if (!n) return; d = ((d % n) + n) % n; var r = a.splice(n - d, d); Array.prototype.unshift.apply(a, r); },
      "static boolean disjoint(Collection<?>,Collection<?>)": function (a, b) { var bb = toArr(b); return !toArr(a).some(function (x) { return bb.some(function (y) { return keyEq(x, y); }); }); }
    } });
    L("java.util.Collections").lib.spec.m["static <T> Set<T> emptySet()"] = function () { var s = J.mkHashSet([]); s.imm = true; return s; };
    function shuffle(l, rnd) { var a = listArr(l); for (var i = a.length; i > 1; i--) { var j = rnd.nextIntB(i), t = a[i - 1]; a[i - 1] = a[j]; a[j] = t; } }

    // ---------- Arrays ----------
    function arrStr(a) {
      if (a === null) return "null";
      var t = a.$c.elemType, f;
      if (t.k === "prim") f = { "char": function (v) { return String.fromCharCode(v); }, "double": I.doubleToString, "float": I.floatToString, "long": function (v) { return v.toString(); } }[t.n] || String;
      else f = toStr;
      return "[" + Array.prototype.map.call(a.a, f).join(", ") + "]";
    }
    function deepStr(a, seen) {
      if (a === null) return "null";
      seen = seen || [];
      return "[" + Array.prototype.map.call(a.a, function (x) {
        if (x instanceof JArr) { if (x.$c.elemType.k === "prim") return arrStr(x); if (seen.indexOf(x) >= 0) return "[...]"; return deepStr(x, seen.concat([a])); }
        return toStr(x);
      }).join(", ") + "]";
    }
    function rangeCheck(n, a, b) {
      if (a > b) throwJ("java.lang.IllegalArgumentException", "fromIndex(" + a + ") > toIndex(" + b + ")");
      if (a < 0) throwJ("java.lang.ArrayIndexOutOfBoundsException", "Array index out of range: " + a);
      if (b > n) throwJ("java.lang.ArrayIndexOutOfBoundsException", "Array index out of range: " + b);
    }
    function primSort(arr, a, b) {
      var t = arr.$c.elemType;
      var part = Array.prototype.slice.call(arr.a, a, b);
      if (t.n === "double" || t.n === "float") part.sort(I.doubleCompare);
      else if (t.n === "long") part.sort(function (x, y) { return x < y ? -1 : x > y ? 1 : 0; });
      else if (t.n === "boolean") return;
      else part.sort(function (x, y) { return x - y; });
      for (var i = 0; i < part.length; i++) arr.a[a + i] = part[i];
    }
    function objSort(arr, a, b, c) {
      var part = Array.prototype.slice.call(arr.a, a, b);
      if (!c) part.forEach(function (x) { if (x === null) npe(); });
      stableSort(part, c);
      for (var i = 0; i < part.length; i++) arr.a[a + i] = part[i];
    }
    function copyOfArr(arr, n) { if (n < 0) throwJ("java.lang.NegativeArraySizeException", String(n)); var r = newArray(arr.$c.elemType, n); for (var i = 0; i < Math.min(n, arr.a.length); i++) r.a[i] = arr.a[i]; return r; }
    var AR = {
      "static String toString(Object[])": function (a) { return jstr(arrStr(a)); },
      "static String deepToString(Object[])": function (a) { return jstr(deepStr(a)); },
      "static <T> List<T> asList(T...)": function (a) { return mkList(a.a, "java.util.ArraysList", { fixed: true }); },
      "static void sort(Object[])": function (a) { objSort(a, 0, a.a.length, null); },
      "static void sort(Object[],int,int)": function (a, x, y) { rangeCheck(a.a.length, x, y); objSort(a, x, y, null); },
      "static <T> void sort(T[],java.util.Comparator<? super T>)": function (a, c) { objSort(a, 0, a.a.length, c); },
      "static <T> void sort(T[],int,int,java.util.Comparator<? super T>)": function (a, x, y, c) { objSort(a, x, y, c); },
      "static <T> void parallelSort(T[],java.util.Comparator<? super T>)": function (a, c) { objSort(a, 0, a.a.length, c); },
      "static void fill(Object[],Object)": function (a, v) { for (var i = 0; i < a.a.length; i++) a.a[i] = v; },
      "static <T> T[] copyOf(T[],int)": copyOfArr,
      "static <T> T[] copyOfRange(T[],int,int)": function (a, x, y) { if (x > y) throwJ("java.lang.IllegalArgumentException", x + " > " + y); var r = newArray(a.$c.elemType, y - x); for (var i = x; i < Math.min(y, a.a.length); i++) r.a[i - x] = a.a[i]; return r; },
      "static boolean equals(Object[],Object[])": function (a, b) { if (a === b) return true; if (a === null || b === null) return false; if (a.a.length !== b.a.length) return false; for (var i = 0; i < a.a.length; i++) if (!keyEq(a.a[i], b.a[i])) return false; return true; },
      "static boolean deepEquals(Object[],Object[])": function (a, b) { return deepStr(a) === deepStr(b); },
      "static int hashCode(Object[])": function (a) { if (a === null) return 0; var h = 1; a.a.forEach(function (x) { h = (Math.imul(31, h) + (x === null ? 0 : jhash(x))) | 0; }); return h; },
      "static <T> java.util.stream.Stream<T> stream(T[])": function (a) { return J.mkStream(Array.from(a.a)); },
      "static <T> java.util.stream.Stream<T> stream(T[],int,int)": function (a, x, y) { return J.mkStream(Array.from(a.a).slice(x, y)); },
      "static java.util.stream.IntStream stream(int[])": function (a) { return mkS("IntStream", arrSrc(Array.from(a.a))); },
      "static java.util.stream.IntStream stream(int[],int,int)": function (a, x, y) { return mkS("IntStream", arrSrc(Array.from(a.a).slice(x, y))); },
      "static java.util.stream.DoubleStream stream(double[])": function (a) { return mkS("DoubleStream", arrSrc(Array.from(a.a))); },
      "static java.util.stream.LongStream stream(long[])": function (a) { return mkS("LongStream", arrSrc(Array.from(a.a))); },
      "static int binarySearch(Object[],Object)": function (a, k) { var lo = 0, hi = a.a.length - 1; while (lo <= hi) { var mid = (lo + hi) >>> 1, c = jcompare(a.a[mid], k); if (c < 0) lo = mid + 1; else if (c > 0) hi = mid - 1; else return mid; } return -(lo + 1); },
      "static <T> void setAll(T[],java.util.function.IntFunction<? extends T>)": function (a, f) { for (var i = 0; i < a.a.length; i++) a.a[i] = call(f, "apply", [i]); }
    };
    ["int", "long", "double", "float", "char", "short", "byte", "boolean"].forEach(function (p) {
      AR["static String toString(" + p + "[])"] = function (a) { return jstr(arrStr(a)); };
      AR["static boolean equals(" + p + "[]," + p + "[])"] = function (a, b) { if (a === b) return true; if (a === null || b === null || a.a.length !== b.a.length) return false; for (var i = 0; i < a.a.length; i++) if (a.a[i] !== b.a[i]) return false; return true; };
      AR["static " + p + "[] copyOf(" + p + "[],int)"] = copyOfArr;
      AR["static " + p + "[] copyOfRange(" + p + "[],int,int)"] = function (a, x, y) { if (x > y) throwJ("java.lang.IllegalArgumentException", x + " > " + y); if (x < 0 || x > a.a.length) throwJ("java.lang.ArrayIndexOutOfBoundsException", "Array index out of range: " + x); var r = newArray(a.$c.elemType, y - x); for (var i = x; i < Math.min(y, a.a.length); i++) r.a[i - x] = a.a[i]; return r; };
      AR["static void fill(" + p + "[]," + p + ")"] = function (a, v) { for (var i = 0; i < a.a.length; i++) a.a[i] = v; };
      AR["static void fill(" + p + "[],int,int," + p + ")"] = function (a, x, y, v) { rangeCheck(a.a.length, x, y); for (var i = x; i < y; i++) a.a[i] = v; };
      AR["static int hashCode(" + p + "[])"] = function (a) { if (a === null) return 0; var h = 1; Array.prototype.forEach.call(a.a, function (x) { h = (Math.imul(31, h) + I.boxHash({ $c: L(I.BOX[p]), v: x })) | 0; }); return h; };
      if (p !== "boolean") {
        AR["static void sort(" + p + "[])"] = function (a) { primSort(a, 0, a.a.length); };
        AR["static void sort(" + p + "[],int,int)"] = function (a, x, y) { rangeCheck(a.a.length, x, y); primSort(a, x, y); };
        AR["static void parallelSort(" + p + "[])"] = function (a) { primSort(a, 0, a.a.length); };
        AR["static int binarySearch(" + p + "[]," + p + ")"] = function (a, k) { var lo = 0, hi = a.a.length - 1; while (lo <= hi) { var mid = (lo + hi) >>> 1, v = a.a[mid]; if (v < k) lo = mid + 1; else if (v > k) hi = mid - 1; else return mid; } return -(lo + 1); };
      }
    });
    AR["static void setAll(int[],java.util.function.IntUnaryOperator)"] = function (a, f) { for (var i = 0; i < a.a.length; i++) a.a[i] = call(f, "applyAsInt", [i]); };
    AR["static void setAll(double[],java.util.function.IntToDoubleFunction)"] = function (a, f) { for (var i = 0; i < a.a.length; i++) a.a[i] = call(f, "applyAsDouble", [i]); };
    defLib("java.util.Arrays", { flags: "public final", noCtor: true, m: AR });

    // ---------- StringJoiner ----------
    defLib("java.util.StringJoiner", { flags: "public final", m: {
      "<init>(CharSequence)": function (d) { this.d = toStr(d); this.p = ""; this.s = ""; this.parts = []; this.empty = null; },
      "<init>(CharSequence,CharSequence,CharSequence)": function (d, p, s) { this.d = toStr(d); this.p = toStr(p); this.s = toStr(s); this.parts = []; this.empty = null; },
      "StringJoiner add(CharSequence)": function (x) { this.parts.push(toStr(x)); return this; },
      "StringJoiner setEmptyValue(CharSequence)": function (x) { this.empty = toStr(x); return this; },
      "int length()": function () { return S(jcall(this, "toString", [])).length; },
      "String toString()": function () { if (!this.parts.length && this.empty !== null) return jstr(this.empty); return jstr(this.p + this.parts.join(this.d) + this.s); }
    } });
  });
})(typeof window !== "undefined" ? window : globalThis);
(function (global) {
  "use strict";
  var JavaSim = global.JavaSim || (typeof require === "function" ? require("./javasim.js") : null);
  JavaSim.addLib(function (J) {
    var I = J._i;
    var defLib = I.defLib, L = I.L, jstr = I.jstr, S = I.S, toStr = I.toStr, jequals = I.jequals, jhash = I.jhash, jcompare = I.jcompare;
    var jcall = I.jcall, throwJ = I.throwJ, npe = I.npe, JBox = I.JBox, JArr = I.JArr, newArray = I.newArray, boxVal = I.boxVal, classOf = I.classOf, T = I.T, OBJ = I.OBJ;
    var toArr = J.toArr, mkList = J.mkList, mkFn = J.mkFn;
    function RT() { return I.rt(); }
    function call(fn, name, args) { if (fn === null) npe(); return jcall(fn, name, args); }

    // ---------- enums da biblioteca ----------
    function libEnum(full, names, extra, opts) {
      var m = {};
      names.forEach(function (n) { m["static final " + full.split(".").pop() + " " + n] = function () { return enumConst(full, n); }; });
      var simple = full.split(".").pop();
      m["static " + simple + "[] values()"] = function () { var arr = newArray(L(full).rawType(), names.length); names.forEach(function (n, i) { arr.a[i] = enumConst(full, n); }); return arr; };
      m["static " + simple + " valueOf(String)"] = function (s) { var n = S(s); if (names.indexOf(n) < 0) throwJ("java.lang.IllegalArgumentException", "No enum constant " + full + "." + n); return enumConst(full, n); };
      if (extra) Object.keys(extra).forEach(function (k) { m[k] = extra[k]; });
      var sym = defLib(full, { kind: "enum", flags: "public final", noCtor: true, m: m, impl: (opts && opts.impl) || [] });
      sym.enumNames = names;
      return sym;
    }
    function enumConst(full, n) {
      var rt = RT();
      rt.libEnums = rt.libEnums || {};
      var tab = rt.libEnums[full] || (rt.libEnums[full] = {});
      if (!tab[n]) tab[n] = { $c: L(full), $name: n, $ord: L(full).enumNames.indexOf(n) };
      return tab[n];
    }
    J.enumConst = enumConst;

    // ---------- BigInteger / BigDecimal ----------
    function bi(v) { return { $c: L("java.math.BigInteger"), big: v }; }
    function bd(u, sc) { return { $c: L("java.math.BigDecimal"), big: u, scale: sc }; }
    function pow10(n) { return 10n ** BigInt(n); }
    function bdParse(s) {
      s = S(s).trim();
      var m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
      if (!m || (!m[2] && !m[3])) throwJ("java.lang.NumberFormatException", "Character " + (s.match(/[^0-9.+\-eE]/) || ["array is missing \"exponent\" mark 'e' or 'E'."])[0] + " is neither a decimal digit number, decimal point, nor \"e\" notation exponential mark.");
      var digits = (m[2] || "") + (m[3] || "");
      var sc = (m[3] || "").length - (m[4] ? parseInt(m[4], 10) : 0);
      var u = BigInt(digits || "0");
      if (m[1] === "-") u = -u;
      return bd(u, sc);
    }
    function bdOfDouble(d) {
      // valor binário exato
      if (!isFinite(d)) throwJ("java.lang.NumberFormatException", "Infinite or NaN");
      if (d === 0) return bd(0n, 0);
      var buf = new DataView(new ArrayBuffer(8)); buf.setFloat64(0, d);
      var hi = buf.getUint32(0), lo = buf.getUint32(4);
      var exp = (hi >>> 20) & 0x7ff, mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
      if (exp) mant |= 1n << 52n; else exp = 1;
      var e2 = exp - 1075;
      var neg = d < 0;
      var u, sc;
      if (e2 >= 0) { u = mant << BigInt(e2); sc = 0; }
      else { u = mant * (5n ** BigInt(-e2)); sc = -e2; }
      // remove zeros à direita desnecessários
      while (sc > 0 && u % 10n === 0n) { u /= 10n; sc--; }
      return bd(neg ? -u : u, sc);
    }
    function align(a, b) { if (a.scale === b.scale) return [a.big, b.big, a.scale]; if (a.scale > b.scale) return [a.big, b.big * pow10(a.scale - b.scale), a.scale]; return [a.big * pow10(b.scale - a.scale), b.big, b.scale]; }
    var RM = ["UP", "DOWN", "CEILING", "FLOOR", "HALF_UP", "HALF_DOWN", "HALF_EVEN", "UNNECESSARY"];
    function roundDiv(n, d, mode) {
      // n/d arredondado (BigInt), mode = nome
      if (d < 0n) { n = -n; d = -d; }
      var q = n / d, r = n % d;
      if (r === 0n) return q;
      var neg = n < 0n;
      var twice = (r < 0n ? -r : r) * 2n;
      var awayFromZero;
      switch (mode) {
        case "UP": awayFromZero = true; break;
        case "DOWN": awayFromZero = false; break;
        case "CEILING": awayFromZero = !neg; break;
        case "FLOOR": awayFromZero = neg; break;
        case "HALF_UP": awayFromZero = twice >= d; break;
        case "HALF_DOWN": awayFromZero = twice > d; break;
        case "HALF_EVEN": awayFromZero = twice > d || (twice === d && (q % 2n !== 0n)); break;
        default: throwJ("java.lang.ArithmeticException", "Rounding necessary");
      }
      return awayFromZero ? (neg ? q - 1n : q + 1n) : q;
    }
    function setScale(x, sc, mode) {
      if (sc === x.scale) return x;
      if (sc > x.scale) return bd(x.big * pow10(sc - x.scale), sc);
      return bd(roundDiv(x.big, pow10(x.scale - sc), mode), sc);
    }
    function modeName(m) { return m === undefined || m === null ? "HALF_UP" : (m.$name || RM[m]); }
    function bdToString(x, plain) {
      var neg = x.big < 0n, digits = (neg ? -x.big : x.big).toString(), sc = x.scale;
      if (plain) {
        if (sc <= 0) return (neg ? "-" : "") + digits + repeat0(-sc);
        while (digits.length <= sc) digits = "0" + digits;
        return (neg ? "-" : "") + digits.slice(0, digits.length - sc) + "." + digits.slice(digits.length - sc);
      }
      var adjusted = -sc + (digits.length - 1);
      if (sc >= 0 && adjusted >= -6) return bdToString(x, true);
      var r = digits.length > 1 ? digits[0] + "." + digits.slice(1) : digits;
      return (neg ? "-" : "") + r + "E" + (adjusted >= 0 ? "+" : "") + adjusted;
    }
    function repeat0(n) { var r = ""; for (var i = 0; i < n; i++) r += "0"; return r; }
    function bdCompare(a, b) { var al = align(a, b); return al[0] < al[1] ? -1 : al[0] > al[1] ? 1 : 0; }
    function precision(u) { var s = (u < 0n ? -u : u).toString(); return u === 0n ? 1 : s.length; }
    function bdRoundMC(x, mc) {
      if (!mc || !mc.prec) return x;
      var p = precision(x.big);
      if (p <= mc.prec) return x;
      var drop = p - mc.prec;
      var r = bd(roundDiv(x.big, pow10(drop), mc.mode), x.scale - drop);
      if (precision(r.big) > mc.prec) r = bd(roundDiv(r.big, 10n, mc.mode), r.scale - 1);
      return r;
    }
    function bdDivide(a, b, sc, mode, mc) {
      if (b.big === 0n) throwJ("java.lang.ArithmeticException", a.big === 0n ? "Division undefined" : "Division by zero", ["java.base/java.math.BigDecimal.divide(BigDecimal.java:1785)"]);
      if (sc !== undefined) {
        // a/b com escala sc: (a.big * 10^(sc - a.scale + b.scale)) / b.big
        var e = sc - a.scale + b.scale;
        var n = e >= 0 ? a.big * pow10(e) : a.big, d = e >= 0 ? b.big : b.big * pow10(-e);
        return bd(roundDiv(n, d, mode), sc);
      }
      if (mc) {
        var extra = mc.prec + 3;
        var q = bdDivide(a, b, Math.max(a.scale, 0) + extra + precision(b.big), "DOWN");
        var exact = bdDivide(a, b, q.scale + 5, "DOWN");
        var r0 = bdRoundMC(bdDivide(a, b, q.scale + 2, mode === undefined ? mc.mode : mode), mc);
        // reduz zeros até a escala preferida
        var pref = a.scale - b.scale;
        while (r0.scale > pref && r0.big % 10n === 0n) r0 = bd(r0.big / 10n, r0.scale - 1);
        void exact;
        return r0;
      }
      // divisão exata
      var N = a.big * pow10(Math.max(0, b.scale)), D = b.big * pow10(Math.max(0, -b.scale));
      var sc0 = a.scale;
      // valor = N / (D * 10^sc0)
      var g = gcd(N < 0n ? -N : N, D < 0n ? -D : D);
      var nn = N / g, dd = D / g;
      if (dd < 0n) { nn = -nn; dd = -dd; }
      var t = dd, k = 0;
      while (t % 2n === 0n) t /= 2n;
      while (t % 5n === 0n) t /= 5n;
      if (t !== 1n) throwJ("java.lang.ArithmeticException", "Non-terminating decimal expansion; no exact representable decimal result.", ["java.base/java.math.BigDecimal.divide(BigDecimal.java:1810)"]);
      var u = nn, s2 = sc0;
      while (u % dd !== 0n) { u *= 10n; s2++; }
      u = u / dd;
      var pref = a.scale - b.scale;
      while (s2 > pref && u % 10n === 0n && u !== 0n) { u /= 10n; s2--; }
      if (u === 0n) s2 = Math.max(pref, 0);
      while (s2 < pref) { u *= 10n; s2++; }
      return bd(u, s2);
    }
    function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a || 1n; }
    J.bdParse = bdParse; J.bdOfDouble = bdOfDouble;
    libEnum("java.math.RoundingMode", RM, {});
    defLib("java.math.MathContext", { flags: "public final", m: {
      "<init>(int)": function (p) { this.prec = p; this.mode = "HALF_UP"; },
      "<init>(int,RoundingMode)": function (p, m) { this.prec = p; this.mode = modeName(m); },
      "static final MathContext DECIMAL128": function () { return { $c: L("java.math.MathContext"), prec: 34, mode: "HALF_EVEN" }; },
      "static final MathContext DECIMAL64": function () { return { $c: L("java.math.MathContext"), prec: 16, mode: "HALF_EVEN" }; },
      "static final MathContext DECIMAL32": function () { return { $c: L("java.math.MathContext"), prec: 7, mode: "HALF_EVEN" }; },
      "static final MathContext UNLIMITED": function () { return { $c: L("java.math.MathContext"), prec: 0, mode: "HALF_UP" }; },
      "String toString()": function () { return jstr("precision=" + this.prec + " roundingMode=" + this.mode); }
    } });
    defLib("java.math.BigDecimal", { ext: "Number", impl: ["Comparable<BigDecimal>"], m: {
      "<init>(String)": function (s) { if (s === null) npe(); var r = bdParse(s); this.big = r.big; this.scale = r.scale; },
      "<init>(double)": function (d) { var r = bdOfDouble(d); this.big = r.big; this.scale = r.scale; },
      "<init>(int)": function (v) { this.big = BigInt(v); this.scale = 0; },
      "<init>(long)": function (v) { this.big = v; this.scale = 0; },
      "<init>(BigInteger)": function (v) { this.big = v.big; this.scale = 0; },
      "static final BigDecimal ZERO": function () { return bd(0n, 0); }, "static final BigDecimal ONE": function () { return bd(1n, 0); },
      "static final BigDecimal TWO": function () { return bd(2n, 0); }, "static final BigDecimal TEN": function () { return bd(10n, 0); },
      "static BigDecimal valueOf(double)": function (d) { return bdParse(I.doubleToString(d)); },
      "static BigDecimal valueOf(long)": function (v) { return bd(v, 0); },
      "static BigDecimal valueOf(long,int)": function (v, s) { return bd(v, s); },
      "BigDecimal add(BigDecimal)": function (o) { var a = align(this, o); return bd(a[0] + a[1], a[2]); },
      "BigDecimal add(BigDecimal,MathContext)": function (o, mc) { var a = align(this, o); return bdRoundMC(bd(a[0] + a[1], a[2]), mc); },
      "BigDecimal subtract(BigDecimal)": function (o) { var a = align(this, o); return bd(a[0] - a[1], a[2]); },
      "BigDecimal multiply(BigDecimal)": function (o) { return bd(this.big * o.big, this.scale + o.scale); },
      "BigDecimal multiply(BigDecimal,MathContext)": function (o, mc) { return bdRoundMC(bd(this.big * o.big, this.scale + o.scale), mc); },
      "BigDecimal divide(BigDecimal)": function (o) { return bdDivide(this, o); },
      "BigDecimal divide(BigDecimal,int,RoundingMode)": function (o, sc, m) { return bdDivide(this, o, sc, modeName(m)); },
      "BigDecimal divide(BigDecimal,RoundingMode)": function (o, m) { return bdDivide(this, o, this.scale, modeName(m)); },
      "BigDecimal divide(BigDecimal,MathContext)": function (o, mc) { return bdDivide(this, o, undefined, undefined, mc); },
      "BigDecimal remainder(BigDecimal)": function (o) { var a = align(this, o); if (a[1] === 0n) throwJ("java.lang.ArithmeticException", "Division by zero"); return bd(a[0] % a[1], a[2]); },
      "BigDecimal divideToIntegralValue(BigDecimal)": function (o) { var a = align(this, o); return bd(a[0] / a[1], 0); },
      "BigDecimal pow(int)": function (n) { return bd(this.big ** BigInt(n), this.scale * n); },
      "BigDecimal negate()": function () { return bd(-this.big, this.scale); },
      "BigDecimal abs()": function () { return bd(this.big < 0n ? -this.big : this.big, this.scale); },
      "BigDecimal setScale(int,RoundingMode)": function (sc, m) { return setScale(this, sc, modeName(m)); },
      "BigDecimal setScale(int)": function (sc) { return setScale(this, sc, "UNNECESSARY"); },
      "BigDecimal round(MathContext)": function (mc) { return bdRoundMC(this, mc); },
      "BigDecimal stripTrailingZeros()": function () { var u = this.big, s = this.scale; if (u === 0n) return bd(0n, 0); while (u % 10n === 0n) { u /= 10n; s--; } return bd(u, s); },
      "BigDecimal max(BigDecimal)": function (o) { return bdCompare(this, o) >= 0 ? this : o; },
      "BigDecimal min(BigDecimal)": function (o) { return bdCompare(this, o) <= 0 ? this : o; },
      "BigDecimal movePointLeft(int)": function (n) { return bd(this.big, this.scale + n); },
      "BigDecimal movePointRight(int)": function (n) { return bd(this.big, this.scale - n); },
      "int signum()": function () { return this.big > 0n ? 1 : this.big < 0n ? -1 : 0; },
      "int scale()": function () { return this.scale; },
      "int precision()": function () { return precision(this.big); },
      "BigInteger unscaledValue()": function () { return bi(this.big); },
      "BigInteger toBigInteger()": function () { return bi(this.scale <= 0 ? this.big * pow10(-this.scale) : this.big / pow10(this.scale)); },
      "int compareTo(BigDecimal)": function (o) { return bdCompare(this, o); },
      "boolean equals(Object)": function (o) { return o !== null && o.$c === this.$c && o.big === this.big && o.scale === this.scale; },
      "int hashCode()": function () { return (Math.imul(31, Number(BigInt.asIntN(32, this.big))) + this.scale) | 0; },
      "String toString()": function () { return jstr(bdToString(this, false)); },
      "String toPlainString()": function () { return jstr(bdToString(this, true)); },
      "double doubleValue()": function () { return parseFloat(bdToString(this, false)); },
      "float floatValue()": function () { return Math.fround(parseFloat(bdToString(this, false))); },
      "int intValue()": function () { return Number(BigInt.asIntN(32, this.scale <= 0 ? this.big * pow10(-this.scale) : this.big / pow10(this.scale))); },
      "long longValue()": function () { return BigInt.asIntN(64, this.scale <= 0 ? this.big * pow10(-this.scale) : this.big / pow10(this.scale)); },
      "int intValueExact()": function () { return Number(this.big / pow10(Math.max(0, this.scale))); }
    } });
    defLib("java.math.BigInteger", { ext: "Number", impl: ["Comparable<BigInteger>"], m: {
      "<init>(String)": function (s) { var t = S(s).trim(); if (!/^[+-]?\d+$/.test(t)) throwJ("java.lang.NumberFormatException", "For input string: \"" + t + "\""); this.big = BigInt(t); },
      "<init>(String,int)": function (s, r) { this.big = BigInt(r === 16 ? "0x" + S(s) : r === 2 ? "0b" + S(s) : S(s)); },
      "static final BigInteger ZERO": function () { return bi(0n); }, "static final BigInteger ONE": function () { return bi(1n); },
      "static final BigInteger TWO": function () { return bi(2n); }, "static final BigInteger TEN": function () { return bi(10n); },
      "static BigInteger valueOf(long)": function (v) { return bi(v); },
      "BigInteger add(BigInteger)": function (o) { return bi(this.big + o.big); },
      "BigInteger subtract(BigInteger)": function (o) { return bi(this.big - o.big); },
      "BigInteger multiply(BigInteger)": function (o) { return bi(this.big * o.big); },
      "BigInteger divide(BigInteger)": function (o) { if (o.big === 0n) throwJ("java.lang.ArithmeticException", "BigInteger divide by zero"); return bi(this.big / o.big); },
      "BigInteger mod(BigInteger)": function (o) { var r = this.big % o.big; return bi(r < 0n ? r + o.big : r); },
      "BigInteger remainder(BigInteger)": function (o) { return bi(this.big % o.big); },
      "BigInteger pow(int)": function (n) { return bi(this.big ** BigInt(n)); },
      "BigInteger negate()": function () { return bi(-this.big); },
      "BigInteger abs()": function () { return bi(this.big < 0n ? -this.big : this.big); },
      "BigInteger gcd(BigInteger)": function (o) { return bi(gcd(this.big < 0n ? -this.big : this.big, o.big < 0n ? -o.big : o.big)); },
      "BigInteger max(BigInteger)": function (o) { return this.big >= o.big ? this : o; },
      "BigInteger min(BigInteger)": function (o) { return this.big <= o.big ? this : o; },
      "BigInteger sqrt()": function () { var n = this.big, x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return bi(x); },
      "boolean isProbablePrime(int)": function () { var n = this.big; if (n < 2n) return false; for (var d = 2n; d * d <= n; d++) if (n % d === 0n) return false; return true; },
      "int signum()": function () { return this.big > 0n ? 1 : this.big < 0n ? -1 : 0; },
      "int bitLength()": function () { return (this.big < 0n ? -this.big : this.big).toString(2).length; },
      "int compareTo(BigInteger)": function (o) { return this.big < o.big ? -1 : this.big > o.big ? 1 : 0; },
      "boolean equals(Object)": function (o) { return o !== null && o.$c === this.$c && o.big === this.big; },
      "int hashCode()": function () { return Number(BigInt.asIntN(32, this.big)); },
      "String toString()": function () { return jstr(this.big.toString()); },
      "String toString(int)": function (r) { return jstr(this.big.toString(r)); },
      "int intValue()": function () { return Number(BigInt.asIntN(32, this.big)); },
      "long longValue()": function () { return BigInt.asIntN(64, this.big); },
      "double doubleValue()": function () { return Number(this.big); },
      "float floatValue()": function () { return Math.fround(Number(this.big)); }
    } });

    // ---------- java.time ----------
    var DIAS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
    var MESES = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
    var DIAS_PT = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"];
    var DIAS_PT_C = ["seg.", "ter.", "qua.", "qui.", "sex.", "sáb.", "dom."];
    var MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    var MESES_PT_C = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
    var DIAS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    var MESES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
    function monthLen(y, m) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
    function epochDay(y, m, d) { return Math.round(Date.UTC(y, m - 1, d) / 86400000) + (y < 100 && y >= 0 ? 0 : 0); }
    function fromEpochDay(n) { var dt = new Date(n * 86400000); return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()]; }
    function fixYear(y, m, d) { var dt = new Date(0); dt.setUTCFullYear(y, m - 1, d); return Math.round(dt.getTime() / 86400000); }
    function ld(y, m, d) { return { $c: L("java.time.LocalDate"), y: y, m: m, d: d }; }
    function ldEpoch(x) { return fixYear(x.y, x.m, x.d); }
    function ldFromEpoch(n) { var dt = new Date(n * 86400000); return ld(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
    function checkDate(y, m, d) {
      if (m < 1 || m > 12) throwJ("java.time.DateTimeException", "Invalid value for MonthOfYear (valid values 1 - 12): " + m, ["java.base/java.time.temporal.ValueRange.checkValidValue(ValueRange.java:319)", "java.base/java.time.temporal.ChronoField.checkValidValue(ChronoField.java:721)", "java.base/java.time.LocalDate.of(LocalDate.java:275)"]);
      if (d < 1 || d > 31) throwJ("java.time.DateTimeException", "Invalid value for DayOfMonth (valid values 1 - 28/31): " + d);
      if (d > monthLen(y, m)) throwJ("java.time.DateTimeException", d === 29 ? "Invalid date 'February 29' as '" + y + "' is not a leap year" : "Invalid date '" + MESES[m - 1] + " " + d + "'");
    }
    function pad(n, w) { var s = String(Math.abs(n)); while (s.length < w) s = "0" + s; return (n < 0 ? "-" : "") + s; }
    function ldStr(x) { return (x.y > 9999 ? "+" : "") + pad(x.y, 4) + "-" + pad(x.m, 2) + "-" + pad(x.d, 2); }
    function plusMonths(x, n) { var tot = x.y * 12 + (x.m - 1) + n; var y = Math.floor(tot / 12), m = tot - y * 12 + 1; return ld(y, m, Math.min(x.d, monthLen(y, m))); }
    function dow(x) { return ((ldEpoch(x) % 7) + 7 + 3) % 7; } // 1970-01-01 foi quinta (índice 3)
    function ldCmp(a, b) { return a.y !== b.y ? a.y - b.y : a.m !== b.m ? a.m - b.m : a.d - b.d; }
    function periodBetween(a, b) {
      var tm = (b.y * 12 + b.m) - (a.y * 12 + a.m), days = b.d - a.d;
      if (tm > 0 && days < 0) { tm--; var c = plusMonths(a, tm); days = ldEpoch(b) - ldEpoch(c); }
      else if (tm < 0 && days > 0) { tm++; days -= monthLen(b.y, b.m); }
      return period(Math.trunc(tm / 12), tm % 12, days);
    }
    function period(y, m, d) { return { $c: L("java.time.Period"), y: y, m: m, d: d }; }
    function lt(h, mi, s, n) { return { $c: L("java.time.LocalTime"), h: h, mi: mi, s: s || 0, n: n || 0 }; }
    function ltStr(t) { var r = pad(t.h, 2) + ":" + pad(t.mi, 2); if (t.s || t.n) { r += ":" + pad(t.s, 2); if (t.n) { var ns = pad(t.n, 9); r += "." + (t.n % 1000000 === 0 ? ns.slice(0, 3) : t.n % 1000 === 0 ? ns.slice(0, 6) : ns); } } return r; }
    function ltSec(t) { return t.h * 3600 + t.mi * 60 + t.s; }
    function ltFromSec(s, n) { s = ((s % 86400) + 86400) % 86400; return lt(Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, n || 0); }
    function ldt(d, t) { return { $c: L("java.time.LocalDateTime"), d: d, t: t }; }
    function ldtPlusSec(x, sec) {
      var tot = ltSec(x.t) + sec, days = Math.floor(tot / 86400);
      return ldt(days ? ldFromEpoch(ldEpoch(x.d) + days) : x.d, ltFromSec(tot - days * 86400, x.t.n));
    }
    function nowParts() { var ms = RT().clockMs(); var loc = ms - 3 * 3600000; var dt = new Date(loc); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours(), mi: dt.getUTCMinutes(), s: dt.getUTCSeconds(), n: 0 }; }
    function dur(sec, nano) { return { $c: L("java.time.Duration"), s: sec, n: nano || 0 }; }
    function durStr(x) {
      var s = x.s; if (s === 0 && !x.n) return "PT0S";
      var h = Math.trunc(s / 3600), m = Math.trunc((s % 3600) / 60), sec = s % 60, r = "PT";
      if (h) r += h + "H"; if (m) r += m + "M";
      if (sec || x.n) r += sec + (x.n ? "." + pad(x.n, 9).replace(/0+$/, "") : "") + "S";
      return r;
    }
    var DOW_M = {
      "int getValue()": function () { return this.$ord + 1; },
      "DayOfWeek plus(long)": function (n) { return enumConst("java.time.DayOfWeek", DIAS[(((this.$ord + Number(n)) % 7) + 7) % 7]); },
      "DayOfWeek minus(long)": function (n) { return enumConst("java.time.DayOfWeek", DIAS[(((this.$ord - Number(n)) % 7) + 7) % 7]); },
      "String getDisplayName(java.time.format.TextStyle,java.util.Locale)": function (st, loc) { var pt = !loc || loc.lang === "pt"; var full = st.$name === "FULL"; return jstr(pt ? (full ? DIAS_PT[this.$ord] : DIAS_PT_C[this.$ord]) : (full ? DIAS_EN[this.$ord] : DIAS_EN[this.$ord].slice(0, 3))); },
      "static DayOfWeek of(int)": function (n) { if (n < 1 || n > 7) throwJ("java.time.DateTimeException", "Invalid value for DayOfWeek: " + n); return enumConst("java.time.DayOfWeek", DIAS[n - 1]); }
    };
    libEnum("java.time.DayOfWeek", DIAS, DOW_M, { impl: ["java.time.temporal.TemporalAccessor"] });
    libEnum("java.time.Month", MESES, {
      "int getValue()": function () { return this.$ord + 1; },
      "int length(boolean)": function (lp) { return monthLen(lp ? 2024 : 2023, this.$ord + 1); },
      "int maxLength()": function () { return monthLen(2024, this.$ord + 1); },
      "Month plus(long)": function (n) { return enumConst("java.time.Month", MESES[(((this.$ord + Number(n)) % 12) + 12) % 12]); },
      "String getDisplayName(java.time.format.TextStyle,java.util.Locale)": function (st, loc) { var pt = !loc || loc.lang === "pt"; var full = st.$name === "FULL"; return jstr(pt ? (full ? MESES_PT[this.$ord] : MESES_PT_C[this.$ord]) : (full ? MESES_EN[this.$ord] : MESES_EN[this.$ord].slice(0, 3))); },
      "static Month of(int)": function (n) { if (n < 1 || n > 12) throwJ("java.time.DateTimeException", "Invalid value for MonthOfYear: " + n); return enumConst("java.time.Month", MESES[n - 1]); }
    });
    defLib("java.time.format.TextStyle", { kind: "interface", m: {} });
    delete I.LIB["java.time.format.TextStyle"];
    libEnum("java.time.format.TextStyle", ["FULL", "FULL_STANDALONE", "SHORT", "SHORT_STANDALONE", "NARROW", "NARROW_STANDALONE"], {});
    defLib("java.time.temporal.TemporalAccessor", { kind: "interface", m: {} });
    defLib("java.time.temporal.Temporal", { kind: "interface", impl: ["TemporalAccessor"], m: {} });
    defLib("java.time.temporal.TemporalAmount", { kind: "interface", m: {} });
    defLib("java.time.chrono.ChronoLocalDate", { kind: "interface", impl: ["java.time.temporal.Temporal"], m: {} });
    var CU = ["NANOS", "MICROS", "MILLIS", "SECONDS", "MINUTES", "HOURS", "HALF_DAYS", "DAYS", "WEEKS", "MONTHS", "YEARS", "DECADES", "CENTURIES", "MILLENNIA", "ERAS", "FOREVER"];
    function between(unit, a, b) {
      var u = unit.$name;
      if (a.$c.full === "java.time.LocalDate") {
        if (u === "DAYS") return BigInt(ldEpoch(b) - ldEpoch(a));
        if (u === "WEEKS") return BigInt(Math.trunc((ldEpoch(b) - ldEpoch(a)) / 7));
        var p = periodBetween(a, b), months = p.y * 12 + p.m;
        if (u === "MONTHS") return BigInt(months);
        if (u === "YEARS") return BigInt(Math.trunc(months / 12));
        if (u === "DECADES") return BigInt(Math.trunc(months / 120));
      }
      var sa = secsOf(a), sb = secsOf(b);
      var diff = sb - sa;
      var div = { NANOS: 1e-9, MILLIS: 1e-3, SECONDS: 1, MINUTES: 60, HOURS: 3600, DAYS: 86400, WEEKS: 604800 }[u] || 1;
      return BigInt(Math.trunc(diff / div));
    }
    function secsOf(x) {
      if (x.$c.full === "java.time.LocalTime") return ltSec(x) + x.n / 1e9;
      if (x.$c.full === "java.time.LocalDateTime") return ldEpoch(x.d) * 86400 + ltSec(x.t);
      if (x.$c.full === "java.time.LocalDate") return ldEpoch(x) * 86400;
      if (x.$c.full === "java.time.Instant") return x.ms / 1000;
      return 0;
    }
    libEnum("java.time.temporal.ChronoUnit", CU, { "long between(java.time.temporal.Temporal,java.time.temporal.Temporal)": function (a, b) { return between(this, a, b); } });
    function plusUnit(x, n, unit) {
      n = Number(n);
      switch (unit.$name) {
        case "DAYS": return jcall(x, "plusDays", [BigInt(n)]);
        case "WEEKS": return jcall(x, "plusWeeks", [BigInt(n)]);
        case "MONTHS": return jcall(x, "plusMonths", [BigInt(n)]);
        case "YEARS": return jcall(x, "plusYears", [BigInt(n)]);
        case "HOURS": return jcall(x, "plusHours", [BigInt(n)]);
        case "MINUTES": return jcall(x, "plusMinutes", [BigInt(n)]);
        case "SECONDS": return jcall(x, "plusSeconds", [BigInt(n)]);
      }
      throwJ("java.time.temporal.UnsupportedTemporalTypeException", "Unsupported unit: " + unit.$name);
    }
    I.defExc("java.time.temporal.UnsupportedTemporalTypeException", "java.time.DateTimeException");
    function parseIsoDate(s) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) { var pat = "dddd-dd-dd", ix = 0; while (ix < s.length && ix < pat.length && (pat[ix] === "d" ? /\d/.test(s[ix]) : s[ix] === pat[ix])) ix++; throwJ("java.time.format.DateTimeParseException", "Text '" + s + "' could not be parsed at index " + ix); }
      var y = +m[1], mo = +m[2], d = +m[3];
      if (mo < 1 || mo > 12) throwJ("java.time.format.DateTimeParseException", "Text '" + s + "' could not be parsed: Invalid value for MonthOfYear (valid values 1 - 12): " + mo);
      if (d < 1 || d > 31) throwJ("java.time.format.DateTimeParseException", "Text '" + s + "' could not be parsed: Invalid value for DayOfMonth (valid values 1 - 28/31): " + d);
      if (d > monthLen(y, mo)) throwJ("java.time.format.DateTimeParseException", "Text '" + s + "' could not be parsed: " + (d === 29 ? "Invalid date 'February 29' as '" + y + "' is not a leap year" : "Invalid date '" + MESES[mo - 1] + " " + d + "'"));
      return ld(y, mo, d);
    }
    var LD = {
      "static LocalDate of(int,int,int)": function (y, m, d) { checkDate(y, m, d); return ld(y, m, d); },
      "static LocalDate of(int,Month,int)": function (y, m, d) { checkDate(y, m.$ord + 1, d); return ld(y, m.$ord + 1, d); },
      "static LocalDate now()": function () { var p = nowParts(); return ld(p.y, p.m, p.d); },
      "static LocalDate parse(CharSequence)": function (s) { return parseIsoDate(toStr(s)); },
      "static LocalDate parse(CharSequence,java.time.format.DateTimeFormatter)": function (s, f) { var r = fmtParse(f, toStr(s)); if (r.y === undefined || r.m === undefined || r.d === undefined) throwJ("java.time.format.DateTimeParseException", "Text '" + toStr(s) + "' could not be parsed: Unable to obtain LocalDate from TemporalAccessor"); return ld(r.y, r.m, Math.min(r.d, monthLen(r.y, r.m))); },
      "static LocalDate ofEpochDay(long)": function (n) { return ldFromEpoch(Number(n)); },
      "static LocalDate ofYearDay(int,int)": function (y, n) { return ldFromEpoch(fixYear(y, 1, 1) + n - 1); },
      "int getYear()": function () { return this.y; }, "int getMonthValue()": function () { return this.m; }, "int getDayOfMonth()": function () { return this.d; },
      "Month getMonth()": function () { return enumConst("java.time.Month", MESES[this.m - 1]); },
      "DayOfWeek getDayOfWeek()": function () { return enumConst("java.time.DayOfWeek", DIAS[dow(this)]); },
      "int getDayOfYear()": function () { return ldEpoch(this) - fixYear(this.y, 1, 1) + 1; },
      "int lengthOfMonth()": function () { return monthLen(this.y, this.m); }, "int lengthOfYear()": function () { return isLeap(this.y) ? 366 : 365; },
      "boolean isLeapYear()": function () { return isLeap(this.y); },
      "LocalDate plusDays(long)": function (n) { return ldFromEpoch(ldEpoch(this) + Number(n)); },
      "LocalDate minusDays(long)": function (n) { return ldFromEpoch(ldEpoch(this) - Number(n)); },
      "LocalDate plusWeeks(long)": function (n) { return ldFromEpoch(ldEpoch(this) + 7 * Number(n)); },
      "LocalDate minusWeeks(long)": function (n) { return ldFromEpoch(ldEpoch(this) - 7 * Number(n)); },
      "LocalDate plusMonths(long)": function (n) { return plusMonths(this, Number(n)); },
      "LocalDate minusMonths(long)": function (n) { return plusMonths(this, -Number(n)); },
      "LocalDate plusYears(long)": function (n) { return plusMonths(this, 12 * Number(n)); },
      "LocalDate minusYears(long)": function (n) { return plusMonths(this, -12 * Number(n)); },
      "LocalDate plus(long,java.time.temporal.ChronoUnit)": function (n, u) { return plusUnit(this, n, u); },
      "LocalDate minus(long,java.time.temporal.ChronoUnit)": function (n, u) { return plusUnit(this, -Number(n), u); },
      "LocalDate plus(Period)": function (p) { return ldFromEpoch(ldEpoch(plusMonths(this, p.y * 12 + p.m)) + p.d); },
      "LocalDate minus(Period)": function (p) { return ldFromEpoch(ldEpoch(plusMonths(this, -(p.y * 12 + p.m))) - p.d); },
      "LocalDate withDayOfMonth(int)": function (d) { checkDate(this.y, this.m, d); return ld(this.y, this.m, d); },
      "LocalDate withMonth(int)": function (m) { return ld(this.y, m, Math.min(this.d, monthLen(this.y, m))); },
      "LocalDate withYear(int)": function (y) { return ld(y, this.m, Math.min(this.d, monthLen(y, this.m))); },
      "LocalDateTime atTime(int,int)": function (h, m) { return ldt(this, lt(h, m)); },
      "LocalDateTime atTime(LocalTime)": function (t) { return ldt(this, t); },
      "LocalDateTime atStartOfDay()": function () { return ldt(this, lt(0, 0)); },
      "boolean isBefore(java.time.chrono.ChronoLocalDate)": function (o) { return ldCmp(this, o) < 0; },
      "boolean isAfter(java.time.chrono.ChronoLocalDate)": function (o) { return ldCmp(this, o) > 0; },
      "boolean isEqual(java.time.chrono.ChronoLocalDate)": function (o) { return ldCmp(this, o) === 0; },
      "int compareTo(java.time.chrono.ChronoLocalDate)": function (o) { var c = this.y - o.y; if (c) return c; c = this.m - o.m; if (c) return c; return this.d - o.d; },
      "long until(java.time.temporal.Temporal,java.time.temporal.ChronoUnit)": function (o, u) { return between(u, this, o); },
      "Period until(java.time.chrono.ChronoLocalDate)": function (o) { return periodBetween(this, o); },
      "long toEpochDay()": function () { return BigInt(ldEpoch(this)); },
      "java.util.stream.Stream<LocalDate> datesUntil(LocalDate)": function (e) { var a = [], n = ldEpoch(this), m = ldEpoch(e); for (; n < m; n++) a.push(ldFromEpoch(n)); return J.mkStream(a); },
      "String format(java.time.format.DateTimeFormatter)": function (f) { return jstr(fmtFormat(f, this)); },
      "String toString()": function () { return jstr(ldStr(this)); },
      "boolean equals(Object)": function (o) { return o !== null && o.$c === this.$c && ldCmp(this, o) === 0; },
      "int hashCode()": function () { return (this.y & 0xFFFFF800) ^ ((this.y << 11) + (this.m << 6) + this.d); },
      "static final LocalDate MIN": function () { return ld(-999999999, 1, 1); }, "static final LocalDate MAX": function () { return ld(999999999, 12, 31); }
    };
    defLib("java.time.LocalDate", { flags: "public final", noCtor: true, impl: ["java.time.chrono.ChronoLocalDate", "Comparable<java.time.chrono.ChronoLocalDate>"], m: LD });
    defLib("java.time.LocalTime", { flags: "public final", noCtor: true, impl: ["java.time.temporal.Temporal", "Comparable<LocalTime>"], m: {
      "static LocalTime of(int,int)": function (h, m) { checkTime(h, m, 0); return lt(h, m); },
      "static LocalTime of(int,int,int)": function (h, m, s) { checkTime(h, m, s); return lt(h, m, s); },
      "static LocalTime now()": function () { var p = nowParts(); return lt(p.h, p.mi, p.s, 0); },
      "static LocalTime parse(CharSequence)": function (s) { var m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(toStr(s)); if (!m) throwJ("java.time.format.DateTimeParseException", "Text '" + toStr(s) + "' could not be parsed at index 0"); return lt(+m[1], +m[2], +(m[3] || 0)); },
      "static LocalTime parse(CharSequence,java.time.format.DateTimeFormatter)": function (s, f) { var r = fmtParse(f, toStr(s)); return lt(r.h || 0, r.mi || 0, r.s || 0); },
      "static final LocalTime MIDNIGHT": function () { return lt(0, 0); }, "static final LocalTime NOON": function () { return lt(12, 0); },
      "int getHour()": function () { return this.h; }, "int getMinute()": function () { return this.mi; }, "int getSecond()": function () { return this.s; },
      "LocalTime plusHours(long)": function (n) { return ltFromSec(ltSec(this) + 3600 * Number(n), this.n); },
      "LocalTime plusMinutes(long)": function (n) { return ltFromSec(ltSec(this) + 60 * Number(n), this.n); },
      "LocalTime plusSeconds(long)": function (n) { return ltFromSec(ltSec(this) + Number(n), this.n); },
      "LocalTime minusHours(long)": function (n) { return ltFromSec(ltSec(this) - 3600 * Number(n), this.n); },
      "LocalTime minusMinutes(long)": function (n) { return ltFromSec(ltSec(this) - 60 * Number(n), this.n); },
      "LocalTime plus(Duration)": function (d) { return ltFromSec(ltSec(this) + d.s, this.n); },
      "LocalTime withHour(int)": function (h) { return lt(h, this.mi, this.s, this.n); },
      "LocalTime withMinute(int)": function (m) { return lt(this.h, m, this.s, this.n); },
      "boolean isBefore(LocalTime)": function (o) { return ltSec(this) < ltSec(o); },
      "boolean isAfter(LocalTime)": function (o) { return ltSec(this) > ltSec(o); },
      "int compareTo(LocalTime)": function (o) { return ltSec(this) - ltSec(o); },
      "String format(java.time.format.DateTimeFormatter)": function (f) { return jstr(fmtFormat(f, this)); },
      "String toString()": function () { return jstr(ltStr(this)); },
      "boolean equals(Object)": function (o) { return o !== null && o.$c === this.$c && ltSec(o) === ltSec(this) && o.n === this.n; },
      "int hashCode()": function () { return ltSec(this); }
    } });
    function checkTime(h, m, s) {
      if (h < 0 || h > 23) throwJ("java.time.DateTimeException", "Invalid value for HourOfDay (valid values 0 - 23): " + h);
      if (m < 0 || m > 59) throwJ("java.time.DateTimeException", "Invalid value for MinuteOfHour (valid values 0 - 59): " + m);
      if (s < 0 || s > 59) throwJ("java.time.DateTimeException", "Invalid value for SecondOfMinute (valid values 0 - 59): " + s);
    }
    defLib("java.time.LocalDateTime", { flags: "public final", noCtor: true, impl: ["java.time.temporal.Temporal", "Comparable<LocalDateTime>"], m: {
      "static LocalDateTime of(int,int,int,int,int)": function (y, m, d, h, mi) { checkDate(y, m, d); checkTime(h, mi, 0); return ldt(ld(y, m, d), lt(h, mi)); },
      "static LocalDateTime of(int,int,int,int,int,int)": function (y, m, d, h, mi, s) { checkDate(y, m, d); checkTime(h, mi, s); return ldt(ld(y, m, d), lt(h, mi, s)); },
      "static LocalDateTime of(LocalDate,LocalTime)": function (d, t) { return ldt(d, t); },
      "static LocalDateTime now()": function () { var p = nowParts(); return ldt(ld(p.y, p.m, p.d), lt(p.h, p.mi, p.s, 0)); },
      "static LocalDateTime parse(CharSequence)": function (s) { var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(toStr(s)); if (!m) throwJ("java.time.format.DateTimeParseException", "Text '" + toStr(s) + "' could not be parsed at index 0"); return ldt(parseIsoDate(m[1]), lt(+m[2], +m[3], +(m[4] || 0))); },
      "static LocalDateTime parse(CharSequence,java.time.format.DateTimeFormatter)": function (s, f) { var r = fmtParse(f, toStr(s)); return ldt(ld(r.y, r.m, r.d), lt(r.h || 0, r.mi || 0, r.s || 0)); },
      "LocalDate toLocalDate()": function () { return this.d; }, "LocalTime toLocalTime()": function () { return this.t; },
      "int getYear()": function () { return this.d.y; }, "int getMonthValue()": function () { return this.d.m; }, "int getDayOfMonth()": function () { return this.d.d; },
      "int getHour()": function () { return this.t.h; }, "int getMinute()": function () { return this.t.mi; }, "int getSecond()": function () { return this.t.s; },
      "Month getMonth()": function () { return enumConst("java.time.Month", MESES[this.d.m - 1]); },
      "DayOfWeek getDayOfWeek()": function () { return enumConst("java.time.DayOfWeek", DIAS[dow(this.d)]); },
      "LocalDateTime plusDays(long)": function (n) { return ldt(ldFromEpoch(ldEpoch(this.d) + Number(n)), this.t); },
      "LocalDateTime minusDays(long)": function (n) { return ldt(ldFromEpoch(ldEpoch(this.d) - Number(n)), this.t); },
      "LocalDateTime plusMonths(long)": function (n) { return ldt(plusMonths(this.d, Number(n)), this.t); },
      "LocalDateTime plusYears(long)": function (n) { return ldt(plusMonths(this.d, 12 * Number(n)), this.t); },
      "LocalDateTime plusWeeks(long)": function (n) { return ldt(ldFromEpoch(ldEpoch(this.d) + 7 * Number(n)), this.t); },
      "LocalDateTime plusHours(long)": function (n) { return ldtPlusSec(this, 3600 * Number(n)); },
      "LocalDateTime plusMinutes(long)": function (n) { return ldtPlusSec(this, 60 * Number(n)); },
      "LocalDateTime plusSeconds(long)": function (n) { return ldtPlusSec(this, Number(n)); },
      "LocalDateTime minusHours(long)": function (n) { return ldtPlusSec(this, -3600 * Number(n)); },
      "LocalDateTime minusMinutes(long)": function (n) { return ldtPlusSec(this, -60 * Number(n)); },
      "LocalDateTime plus(Duration)": function (d) { return ldtPlusSec(this, d.s); },
      "boolean isBefore(LocalDateTime)": function (o) { return secsOf(this) < secsOf(o); },
      "boolean isAfter(LocalDateTime)": function (o) { return secsOf(this) > secsOf(o); },
      "int compareTo(LocalDateTime)": function (o) { var a = secsOf(this), b = secsOf(o); return a < b ? -1 : a > b ? 1 : 0; },
      "String format(java.time.format.DateTimeFormatter)": function (f) { return jstr(fmtFormat(f, this)); },
      "String toString()": function () { return jstr(ldStr(this.d) + "T" + ltStr(this.t)); },
      "boolean equals(Object)": function (o) { return o !== null && o.$c === this.$c && secsOf(o) === secsOf(this); },
      "int hashCode()": function () { return secsOf(this) | 0; }
    } });
    defLib("java.time.Instant", { flags: "public final", noCtor: true, impl: ["java.time.temporal.Temporal", "Comparable<Instant>"], m: {
      "static Instant now()": function () { return { $c: L("java.time.Instant"), ms: RT().clockMs() }; },
      "static Instant ofEpochMilli(long)": function (n) { return { $c: L("java.time.Instant"), ms: Number(n) }; },
      "long toEpochMilli()": function () { return BigInt(Math.floor(this.ms)); },
      "long getEpochSecond()": function () { return BigInt(Math.floor(this.ms / 1000)); },
      "Instant plusSeconds(long)": function (n) { return { $c: L("java.time.Instant"), ms: this.ms + 1000 * Number(n) }; },
      "int compareTo(Instant)": function (o) { return this.ms < o.ms ? -1 : this.ms > o.ms ? 1 : 0; },
      "String toString()": function () { return jstr(new Date(Math.floor(this.ms)).toISOString().replace(/\.000Z$/, "Z")); }
    } });
    defLib("java.time.Duration", { flags: "public final", noCtor: true, impl: ["java.time.temporal.TemporalAmount", "Comparable<Duration>"], m: {
      "static Duration ofDays(long)": function (n) { return dur(86400 * Number(n)); },
      "static Duration ofHours(long)": function (n) { return dur(3600 * Number(n)); },
      "static Duration ofMinutes(long)": function (n) { return dur(60 * Number(n)); },
      "static Duration ofSeconds(long)": function (n) { return dur(Number(n)); },
      "static Duration ofMillis(long)": function (n) { var m = Number(n); return dur(Math.floor(m / 1000), (m % 1000) * 1e6); },
      "static Duration between(java.time.temporal.Temporal,java.time.temporal.Temporal)": function (a, b) { var d = secsOf(b) - secsOf(a); var s = Math.floor(d); return dur(s, Math.round((d - s) * 1e9)); },
      "static final Duration ZERO": function () { return dur(0); },
      "long toDays()": function () { return BigInt(Math.trunc(this.s / 86400)); },
      "long toHours()": function () { return BigInt(Math.trunc(this.s / 3600)); },
      "long toMinutes()": function () { return BigInt(Math.trunc(this.s / 60)); },
      "long toSeconds()": function () { return BigInt(this.s); },
      "long getSeconds()": function () { return BigInt(this.s); },
      "long toMillis()": function () { return BigInt(this.s * 1000 + Math.floor(this.n / 1e6)); },
      "int toMinutesPart()": function () { return Math.trunc(this.s / 60) % 60; },
      "int toHoursPart()": function () { return Math.trunc(this.s / 3600) % 24; },
      "int toSecondsPart()": function () { return this.s % 60; },
      "Duration plus(Duration)": function (o) { return dur(this.s + o.s, this.n + o.n); },
      "Duration plusMinutes(long)": function (n) { return dur(this.s + 60 * Number(n), this.n); },
      "Duration minus(Duration)": function (o) { return dur(this.s - o.s, this.n - o.n); },
      "Duration multipliedBy(long)": function (n) { return dur(this.s * Number(n), this.n * Number(n)); },
      "boolean isNegative()": function () { return this.s < 0; },
      "boolean isZero()": function () { return this.s === 0 && !this.n; },
      "int compareTo(Duration)": function (o) { return this.s !== o.s ? (this.s < o.s ? -1 : 1) : this.n - o.n; },
      "String toString()": function () { return jstr(durStr(this)); },
      "boolean equals(Object)": function (o) { return o !== null && o.$c === this.$c && o.s === this.s && o.n === this.n; }
    } });
    defLib("java.time.Period", { flags: "public final", noCtor: true, impl: ["java.time.temporal.TemporalAmount"], m: {
      "static Period of(int,int,int)": function (y, m, d) { return period(y, m, d); },
      "static Period ofDays(int)": function (d) { return period(0, 0, d); },
      "static Period ofMonths(int)": function (m) { return period(0, m, 0); },
      "static Period ofYears(int)": function (y) { return period(y, 0, 0); },
      "static Period ofWeeks(int)": function (w) { return period(0, 0, 7 * w); },
      "static Period between(LocalDate,LocalDate)": function (a, b) { return periodBetween(a, b); },
      "int getYears()": function () { return this.y; }, "int getMonths()": function () { return this.m; }, "int getDays()": function () { return this.d; },
      "long toTotalMonths()": function () { return BigInt(this.y * 12 + this.m); },
      "Period plusDays(long)": function (n) { return period(this.y, this.m, this.d + Number(n)); },
      "boolean isNegative()": function () { return this.y < 0 || this.m < 0 || this.d < 0; },
      "String toString()": function () { if (!this.y && !this.m && !this.d) return jstr("P0D"); return jstr("P" + (this.y ? this.y + "Y" : "") + (this.m ? this.m + "M" : "") + (this.d ? this.d + "D" : "")); },
      "boolean equals(Object)": function (o) { return o !== null && o.$c === this.$c && o.y === this.y && o.m === this.m && o.d === this.d; }
    } });
    defLib("java.time.ZoneId", { flags: "public abstract", noCtor: true, m: {
      "static ZoneId of(String)": function (s) { return { $c: L("java.time.ZoneId"), id: S(s) }; },
      "static ZoneId systemDefault()": function () { return { $c: L("java.time.ZoneId"), id: "America/Sao_Paulo" }; },
      "String getId()": function () { return jstr(this.id); },
      "String toString()": function () { return jstr(this.id); }
    } });
    // ---------- DateTimeFormatter ----------
    function tokenize(p) {
      var toks = [], i = 0;
      while (i < p.length) {
        var c = p[i];
        if (c === "'") {
          var j = p.indexOf("'", i + 1); if (j < 0) j = p.length;
          toks.push({ lit: j === i + 1 ? "'" : p.slice(i + 1, j) }); i = j + 1; continue;
        }
        if (/[A-Za-z]/.test(c)) { var k = i; while (k < p.length && p[k] === c) k++; toks.push({ f: c, n: k - i }); i = k; continue; }
        toks.push({ lit: c }); i++;
      }
      return toks;
    }
    function mkFmt(pattern, loc, iso) { return { $c: L("java.time.format.DateTimeFormatter"), pat: pattern, toks: pattern ? tokenize(pattern) : null, loc: loc || null, iso: iso || null }; }
    function fmtFormat(f, x) {
      var d = x.$c.full === "java.time.LocalDate" ? x : x.$c.full === "java.time.LocalDateTime" ? x.d : null;
      var t = x.$c.full === "java.time.LocalTime" ? x : x.$c.full === "java.time.LocalDateTime" ? x.t : null;
      if (f.iso) {
        if (f.iso === "date") return ldStr(d); if (f.iso === "time") return ltStr(t); if (f.iso === "datetime") return ldStr(d) + "T" + ltStr(t);
      }
      var pt = !f.loc || f.loc.lang === "pt";
      return f.toks.map(function (tk) {
        if (tk.lit !== undefined) return tk.lit;
        var n = tk.n;
        function need(v, what) { if (!v) throwJ("java.time.temporal.UnsupportedTemporalTypeException", "Unsupported field: " + what); return v; }
        switch (tk.f) {
          case "d": return pad(need(d, "DayOfMonth").d, n);
          case "M": case "L": need(d, "MonthOfYear"); if (n >= 4) return pt ? MESES_PT[d.m - 1] : MESES_EN[d.m - 1]; if (n === 3) return pt ? MESES_PT_C[d.m - 1] : MESES_EN[d.m - 1].slice(0, 3); return pad(d.m, n);
          case "y": case "u": need(d, "YearOfEra"); return n === 2 ? pad(d.y % 100, 2) : pad(d.y, n);
          case "E": need(d, "DayOfWeek"); return n >= 4 ? (pt ? DIAS_PT[dow(d)] : DIAS_EN[dow(d)]) : (pt ? DIAS_PT_C[dow(d)] : DIAS_EN[dow(d)].slice(0, 3));
          case "D": need(d, "DayOfYear"); return pad(ldEpoch(d) - fixYear(d.y, 1, 1) + 1, n);
          case "H": return pad(need(t, "HourOfDay").h, n);
          case "h": need(t, "ClockHourOfAmPm"); return pad(t.h % 12 === 0 ? 12 : t.h % 12, n);
          case "m": return pad(need(t, "MinuteOfHour").mi, n);
          case "s": return pad(need(t, "SecondOfMinute").s, n);
          case "S": return pad(Math.floor(need(t, "NanoOfSecond").n / Math.pow(10, 9 - n)), n);
          case "a": need(t, "AmPmOfDay"); return pt ? (t.h < 12 ? "AM" : "PM") : (t.h < 12 ? "AM" : "PM");
        }
        throwJ("java.lang.IllegalArgumentException", "Unknown pattern letter: " + tk.f);
      }).join("");
    }
    function fmtParse(f, s) {
      if (f.iso === "date") { var dd = parseIsoDate(s); return { y: dd.y, m: dd.m, d: dd.d }; }
      var r = {}, i = 0;
      var pt = !f.loc || f.loc.lang === "pt";
      function fail() { throwJ("java.time.format.DateTimeParseException", "Text '" + s + "' could not be parsed at index " + i); }
      (f.toks || []).forEach(function (tk) {
        if (tk.lit !== undefined) { if (s.substr(i, tk.lit.length) !== tk.lit) fail(); i += tk.lit.length; return; }
        if ((tk.f === "M" && tk.n >= 3) || tk.f === "E") {
          var lists = tk.f === "M" ? (tk.n >= 4 ? (pt ? MESES_PT : MESES_EN) : (pt ? MESES_PT_C : MESES_EN.map(function (x) { return x.slice(0, 3); }))) : (tk.n >= 4 ? (pt ? DIAS_PT : DIAS_EN) : (pt ? DIAS_PT_C : DIAS_EN.map(function (x) { return x.slice(0, 3); })));
          for (var q = 0; q < lists.length; q++) if (s.substr(i, lists[q].length).toLowerCase() === lists[q].toLowerCase()) { if (tk.f === "M") r.m = q + 1; i += lists[q].length; return; }
          fail();
        }
        var m = new RegExp("^\\d{" + tk.n + "," + (tk.n === 1 ? 2 : (tk.f === "y" || tk.f === "u") && tk.n !== 2 ? 9 : tk.n) + "}").exec(s.slice(i));
        if (!m) fail();
        var v = parseInt(m[0], 10);
        i += m[0].length;
        switch (tk.f) { case "d": r.d = v; break; case "M": r.m = v; break; case "y": case "u": r.y = tk.n === 2 ? 2000 + v : v; break; case "H": r.h = v; break; case "m": r.mi = v; break; case "s": r.s = v; break; }
      });
      if (i < s.length) throwJ("java.time.format.DateTimeParseException", "Text '" + s + "' could not be parsed, unparsed text found at index " + i);
      if (r.m !== undefined && (r.m < 1 || r.m > 12)) throwJ("java.time.format.DateTimeParseException", "Text '" + s + "' could not be parsed: Invalid value for MonthOfYear (valid values 1 - 12): " + r.m);
      if (r.d !== undefined && (r.d < 1 || r.d > 31)) throwJ("java.time.format.DateTimeParseException", "Text '" + s + "' could not be parsed: Invalid value for DayOfMonth (valid values 1 - 28/31): " + r.d);
      return r;
    }
    defLib("java.time.format.DateTimeFormatter", { flags: "public final", noCtor: true, m: {
      "static DateTimeFormatter ofPattern(String)": function (p) { return mkFmt(S(p)); },
      "static DateTimeFormatter ofPattern(String,java.util.Locale)": function (p, l) { return mkFmt(S(p), l); },
      "static final DateTimeFormatter ISO_LOCAL_DATE": function () { return mkFmt(null, null, "date"); },
      "static final DateTimeFormatter ISO_DATE": function () { return mkFmt(null, null, "date"); },
      "static final DateTimeFormatter ISO_LOCAL_TIME": function () { return mkFmt(null, null, "time"); },
      "static final DateTimeFormatter ISO_LOCAL_DATE_TIME": function () { return mkFmt(null, null, "datetime"); },
      "DateTimeFormatter withLocale(java.util.Locale)": function (l) { return mkFmt(this.pat, l, this.iso); },
      "String format(java.time.temporal.TemporalAccessor)": function (x) { return jstr(fmtFormat(this, x)); },
      "String toString()": function () { return jstr(this.pat || "ParseCaseSensitive(false)"); }
    } });
    I.LIB["java.time.LocalDate"].lib.spec.impl.push("java.time.temporal.TemporalAccessor");

    // ---------- NumberFormat / DecimalFormat ----------
    function fmtNumber(v, minFrac, maxFrac, grouping, loc, mode) {
      var neg = v < 0 || (v === 0 && 1 / v < 0 && false);
      var x = J.bdOfDouble(Math.abs(v));
      var r = (function () { var b = x; if (b.scale > maxFrac) { var div = 10n ** BigInt(b.scale - maxFrac); var q = b.big / div, rem = b.big % div; var tw = rem * 2n; if (mode === "HALF_UP" ? tw >= div : (tw > div || (tw === div && q % 2n === 1n))) q++; return { big: q, scale: maxFrac }; } return b; })();
      var digits = r.big.toString(), sc = r.scale;
      while (digits.length <= sc) digits = "0" + digits;
      var ip = digits.slice(0, digits.length - sc), fp = digits.slice(digits.length - sc);
      while (fp.length > minFrac && fp[fp.length - 1] === "0") fp = fp.slice(0, -1);
      while (fp.length < minFrac) fp += "0";
      if (grouping) ip = I.groupDigits(ip, loc.grp);
      var res = ip + (fp ? loc.dec + fp : "");
      if (neg && /[1-9]/.test(res)) res = "-" + res;
      return res;
    }
    function locOf(l) { return l && l.loc ? l.loc : I.LOC_PT; }
    defLib("java.text.Format", { flags: "public abstract", m: { "String format(Object)": function (o) { return jcall(this, "format", [o]); } } });
    defLib("java.text.NumberFormat", { flags: "public abstract", ext: "java.text.Format", m: {
      "static NumberFormat getCurrencyInstance()": function () { return { $c: L("java.text.DecimalFormat"), kind: "cur", l: J.mkLocale("pt", "BR"), min: 2, max: 2, grp: true }; },
      "static NumberFormat getCurrencyInstance(java.util.Locale)": function (l) { return { $c: L("java.text.DecimalFormat"), kind: "cur", l: l, min: 2, max: 2, grp: true }; },
      "static NumberFormat getInstance()": function () { return { $c: L("java.text.DecimalFormat"), kind: "num", l: J.mkLocale("pt", "BR"), min: 0, max: 3, grp: true }; },
      "static NumberFormat getInstance(java.util.Locale)": function (l) { return { $c: L("java.text.DecimalFormat"), kind: "num", l: l, min: 0, max: 3, grp: true }; },
      "static NumberFormat getNumberInstance()": function () { return { $c: L("java.text.DecimalFormat"), kind: "num", l: J.mkLocale("pt", "BR"), min: 0, max: 3, grp: true }; },
      "static NumberFormat getNumberInstance(java.util.Locale)": function (l) { return { $c: L("java.text.DecimalFormat"), kind: "num", l: l, min: 0, max: 3, grp: true }; },
      "static NumberFormat getPercentInstance()": function () { return { $c: L("java.text.DecimalFormat"), kind: "pct", l: J.mkLocale("pt", "BR"), min: 0, max: 0, grp: true }; },
      "static NumberFormat getPercentInstance(java.util.Locale)": function (l) { return { $c: L("java.text.DecimalFormat"), kind: "pct", l: l, min: 0, max: 0, grp: true }; },
      "static NumberFormat getIntegerInstance()": function () { return { $c: L("java.text.DecimalFormat"), kind: "num", l: J.mkLocale("pt", "BR"), min: 0, max: 0, grp: true }; },
      "String format(double)": function (v) { return jstr(nfFormat(this, v)); },
      "String format(long)": function (v) { return jstr(nfFormat(this, Number(v))); },
      "void setMinimumFractionDigits(int)": function (n) { this.min = n; if (this.max < n) this.max = n; },
      "void setMaximumFractionDigits(int)": function (n) { this.max = n; if (this.min > n) this.min = n; },
      "void setGroupingUsed(boolean)": function (b) { this.grp = b; },
      "Number parse(String) throws java.text.ParseException": function (s) { var t = S(s).replace(/R\$\s?| |%/g, "").split(locOf(this.l).grp).join("").replace(locOf(this.l).dec, "."); var v = parseFloat(t); if (isNaN(v)) throwJ("java.text.ParseException", "Unparseable number: \"" + S(s) + "\""); return Number.isInteger(v) ? boxVal("long", BigInt(v)) : boxVal("double", v); }
    } });
    I.defExc("java.text.ParseException", "Exception", { m: { "<init>(String,int)": function (s) { this.message = s; this.cause = null; this.suppressed = []; } } });
    function nfFormat(f, v) {
      var loc = locOf(f.l);
      if (f.pat) return dfFormat(f, v, loc);
      var us = f.l && f.l.lang === "en";
      if (f.kind === "cur") { var n = fmtNumber(Math.abs(v), f.min, f.max, f.grp, loc, "HALF_EVEN"); var sym = us ? "$" : "R$ "; return (v < 0 ? "-" : "") + sym + n; }
      if (f.kind === "pct") return fmtNumber(v * 100, f.min, f.max, f.grp, loc, "HALF_EVEN") + "%";
      return fmtNumber(v, f.min, f.max, f.grp, loc, "HALF_EVEN");
    }
    function dfFormat(f, v, loc) {
      var p = f.pat.split(";")[0];
      var m = /^([^#0,.]*)([#0,]*)(?:\.([0#]*))?(.*)$/.exec(p);
      var pre = m[1].replace(/'/g, ""), intp = m[2], fr = m[3] || "", suf = m[4].replace(/'/g, "");
      var pct = /%/.test(suf);
      if (pct) v *= 100;
      var minFrac = (fr.match(/0/g) || []).length, maxFrac = fr.length;
      var minInt = (intp.match(/0/g) || []).length;
      var grp = intp.indexOf(",") >= 0;
      var s = fmtNumber(Math.abs(v), minFrac, maxFrac, false, loc, f.mode || "HALF_EVEN");
      var parts = s.split(loc.dec), ip = parts[0];
      if (ip === "0" && minInt === 0 && parts[1]) ip = "";
      while (ip.length < minInt) ip = "0" + ip;
      if (grp) ip = I.groupDigits(ip, loc.grp);
      var res = ip + (parts[1] ? loc.dec + parts[1] : "");
      return (v < 0 && /[1-9]/.test(res) ? "-" : "") + pre + res + suf;
    }
    defLib("java.text.DecimalFormat", { ext: "java.text.NumberFormat", m: {
      "<init>(String)": function (p) { this.pat = S(p); this.l = J.mkLocale("pt", "BR"); },
      "<init>(String,java.text.DecimalFormatSymbols)": function (p, sy) { this.pat = S(p); this.l = sy.l; },
      "void setRoundingMode(java.math.RoundingMode)": function (m) { this.mode = m.$name; },
      "void applyPattern(String)": function (p) { this.pat = S(p); }
    } });
    defLib("java.text.DecimalFormatSymbols", { m: { "<init>(java.util.Locale)": function (l) { this.l = l; } } });
    defLib("java.text.SimpleDateFormat", { ext: "java.text.Format", m: { "<init>(String)": function (p) { this.pat = S(p); } } });

    // ---------- regex ----------
    function mkMatcher(p, s) { return { $c: L("java.util.regex.Matcher"), p: p, s: s, re: I.javaRegex(p.src, "g" + p.fl), m: null, pos: 0, appendPos: 0 }; }
    function noMatch(frames) { throwJ("java.lang.IllegalStateException", "No match found", frames || ["java.base/java.util.regex.Matcher.checkMatch(Matcher.java:1850)", "java.base/java.util.regex.Matcher.group(Matcher.java:685)", "java.base/java.util.regex.Matcher.group(Matcher.java:643)"]); }
    defLib("java.util.regex.Pattern", { flags: "public final", noCtor: true, m: {
      "static final int CASE_INSENSITIVE": { c: 2 }, "static final int MULTILINE": { c: 8 }, "static final int DOTALL": { c: 32 }, "static final int UNICODE_CASE": { c: 64 }, "static final int COMMENTS": { c: 4 },
      "static Pattern compile(String)": function (r) { var p = { $c: L("java.util.regex.Pattern"), src: S(r), fl: "" }; I.javaRegex(p.src); return p; },
      "static Pattern compile(String,int)": function (r, f) { var fl = (f & 2 ? "i" : "") + (f & 8 ? "m" : "") + (f & 32 ? "s" : ""); var p = { $c: L("java.util.regex.Pattern"), src: S(r), fl: fl, flags: f }; I.javaRegex(p.src, fl); return p; },
      "static boolean matches(String,CharSequence)": function (r, s) { return I.javaRegex("^(?:" + S(r) + ")$").test(toStr(s)); },
      "static String quote(String)": function (s) { return jstr(S(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); },
      "Matcher matcher(CharSequence)": function (s) { return mkMatcher(this, toStr(s)); },
      "String pattern()": function () { return jstr(this.src); },
      "String toString()": function () { return jstr(this.src); },
      "int flags()": function () { return this.flags || 0; },
      "String[] split(CharSequence)": function (s) { return I.strArray(I.jsplit(toStr(s), this.src, 0)); },
      "java.util.function.Predicate<String> asPredicate()": function () { var re = I.javaRegex(this.src, this.fl); return mkFn("Predicate", function (x) { return re.test(S(x)); }); },
      "java.util.function.Predicate<String> asMatchPredicate()": function () { var re = I.javaRegex("^(?:" + this.src + ")$", this.fl); return mkFn("Predicate", function (x) { return re.test(S(x)); }); },
      "java.util.stream.Stream<String> splitAsStream(CharSequence)": function (s) { return J.mkStream(I.jsplit(toStr(s), this.src, 0).map(jstr)); }
    } });
    defLib("java.util.regex.MatchResult", { kind: "interface", m: { "String group()": null, "String group(int)": null, "int start()": null, "int end()": null, "int groupCount()": null } });
    defLib("java.util.regex.Matcher", { flags: "public final", noCtor: true, impl: ["MatchResult"], m: {
      "boolean matches()": function () { var re = I.javaRegex("^(?:" + this.p.src + ")$", this.p.fl); var m = re.exec(this.s); this.m = m; return !!m; },
      "boolean lookingAt()": function () { var re = I.javaRegex("^(?:" + this.p.src + ")", this.p.fl); var m = re.exec(this.s); this.m = m; return !!m; },
      "boolean find()": function () { this.re.lastIndex = this.pos; var m = this.re.exec(this.s); this.m = m; if (m) { this.pos = m.index + (m[0].length || 1); } else this.pos = this.s.length + 1; return !!m; },
      "boolean find(int)": function (i) { this.pos = i; return jcall(this, "find", []); },
      "String group()": function () { if (!this.m) noMatch(); return jstr(this.m[0]); },
      "String group(int)": function (n) { if (!this.m) noMatch(["java.base/java.util.regex.Matcher.checkMatch(Matcher.java:1850)", "java.base/java.util.regex.Matcher.group(Matcher.java:685)"]); if (n > this.m.length - 1) throwJ("java.lang.IndexOutOfBoundsException", "No group " + n); var g = this.m[n]; return g === undefined ? null : jstr(g); },
      "String group(String)": function (n) { if (!this.m) noMatch(); var g = this.m.groups && this.m.groups[S(n)]; if (g === undefined && !(this.m.groups && S(n) in this.m.groups)) throwJ("java.lang.IllegalArgumentException", "No group with name <" + S(n) + ">"); return g === undefined ? null : jstr(g); },
      "int groupCount()": function () { return new RegExp(this.re.source + "|").exec("").length - 1; },
      "int start()": function () { if (!this.m) noMatch(); return this.m.index; },
      "int end()": function () { if (!this.m) noMatch(); return this.m.index + this.m[0].length; },
      "String replaceAll(String)": function (r) { return jstr(this.s.replace(I.javaRegex(this.p.src, "g" + this.p.fl), S(r).replace(/\$(\d)/g, "$$$1"))); },
      "String replaceFirst(String)": function (r) { return jstr(this.s.replace(I.javaRegex(this.p.src, this.p.fl), S(r))); },
      "java.util.stream.Stream<MatchResult> results()": function () { var out = [], re = I.javaRegex(this.p.src, "g" + this.p.fl), m; while ((m = re.exec(this.s))) { out.push({ $c: L("java.util.regex.Matcher"), m: m, s: this.s, p: this.p, re: re }); if (!m[0].length) re.lastIndex++; } return J.mkStream(out); },
      "Matcher reset()": function () { this.pos = 0; this.m = null; return this; },
      "boolean hitEnd()": function () { return this.pos >= this.s.length; }
    } });

    // ---------- arquivos (sistema de arquivos fictício: a pasta da Ana) ----------
    var HOME = "/home/ana";
    function fs() {
      var rt = RT();
      if (!rt.fsMap) {
        rt.fsMap = {};
        ["/", "/home", HOME, HOME + "/Documentos", HOME + "/Downloads", HOME + "/Imagens", HOME + "/Música", HOME + "/Vídeos", HOME + "/Área de trabalho", "/tmp"].forEach(function (d) { rt.fsMap[d] = { t: "d" }; });
        rt.fsMap[HOME + "/frutas.txt"] = { t: "f", d: "banana\nmaçã\nlaranja\nbanana\nuva\nmaçã\nbanana\n" };
        rt.fsMap[HOME + "/Documentos/alunos.csv"] = { t: "f", d: "nome,idade,cidade,nota\nAna,29,Recife,9.5\nBruno,34,Curitiba,7.0\nCarla,22,Salvador,8.5\nDiego,41,Manaus,6.0\n" };
        rt.fsMap[HOME + "/Documentos/notas.txt"] = { t: "f", d: "Comprar café\nLigar para o João\nEstudar Bash\nFazer backup das fotos\n" };
        if (rt.fsInit) rt.fsInit(rt.fsMap);
      }
      return rt.fsMap;
    }
    function norm(p) {
      var abs = p[0] === "/" ? p : HOME + "/" + p;
      var parts = [], out = abs.split("/");
      out.forEach(function (x) { if (!x || x === ".") return; if (x === "..") parts.pop(); else parts.push(x); });
      return "/" + parts.join("/");
    }
    function parent(p) { var i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); }
    function pathStr(x) { return isPath(x) ? x.p : S(x); }
    function isPath(x) { return x && x.$c && (x.$c.full === "java.nio.file.PathImpl" || x.$c.full === "java.io.File"); }
    function mkPath(s) { return { $c: L("java.nio.file.PathImpl"), p: s }; }
    var NSF_READ = ["java.base/sun.nio.fs.UnixException.translateToIOException(UnixException.java:92)", "java.base/sun.nio.fs.UnixException.rethrowAsIOException(UnixException.java:106)", "java.base/sun.nio.fs.UnixException.rethrowAsIOException(UnixException.java:111)", "java.base/sun.nio.fs.UnixFileSystemProvider.newFileChannel(UnixFileSystemProvider.java:213)", "java.base/sun.nio.fs.UnixFileSystemProvider.newByteChannel(UnixFileSystemProvider.java:244)", "java.base/java.nio.file.Files.newByteChannel(Files.java:357)", "java.base/java.nio.file.Files.newByteChannel(Files.java:399)"];
    function readFile(p, frames) {
      var a = norm(pathStr(p)), n = fs()[a];
      if (!n) throwJ("java.nio.file.NoSuchFileException", jstr(pathStr(p)), frames);
      if (n.t === "d") throwJ("java.io.IOException", "Is a directory");
      return n.d;
    }
    J.readFileText = function (p) { var a = norm(pathStr(p)), n = fs()[a]; if (!n) throwJ("java.io.FileNotFoundException", pathStr(p) + " (Arquivo ou diretório inexistente)"); return n.d; };
    function writeFile(p, text, append) {
      var a = norm(pathStr(p)), f = fs();
      if (!f[parent(a)] || f[parent(a)].t !== "d") throwJ("java.nio.file.NoSuchFileException", jstr(pathStr(p)));
      if (f[a] && f[a].t === "d") throwJ("java.nio.file.FileSystemException", pathStr(p) + ": É um diretório");
      if (append && f[a]) f[a].d += text; else f[a] = { t: "f", d: text };
    }
    function hasOpt(opts, name) { return opts && opts.a && opts.a.some(function (o) { return o && o.$name === name; }); }
    function utf8len(s) { return unescape(encodeURIComponent(s)).length; }
    function linesOf(t) { var ls = t.split(/\r?\n/); if (ls[ls.length - 1] === "") ls.pop(); return ls; }
    defLib("java.nio.file.Path", { kind: "interface", impl: ["Comparable<Path>", "Iterable<Path>"], m: {
      "static Path of(String,String...)": function (a, rest) { return mkPath([S(a)].concat(Array.from(rest.a).map(S)).join("/").replace(/\/+/g, "/")); },
      "Path getFileName()": null, "Path getParent()": null, "Path resolve(String)": null, "Path toAbsolutePath()": null, "boolean isAbsolute()": null, "java.io.File toFile()": null, "Path normalize()": null,
      "Path resolve(Path)": null, "Path getRoot()": null, "int getNameCount()": null, "Path resolveSibling(String)": null, "boolean startsWith(String)": null, "boolean endsWith(String)": null
    } });
    defLib("java.nio.file.PathImpl", { impl: ["Path"], bin: "sun.nio.fs.UnixPath", m: {
      "Path getFileName()": function () { var p = this.p.replace(/\/+$/, ""); return p === "" ? null : mkPath(p.slice(p.lastIndexOf("/") + 1)); },
      "Path getParent()": function () { var i = this.p.replace(/\/+$/, "").lastIndexOf("/"); return i < 0 ? null : mkPath(i === 0 ? "/" : this.p.slice(0, i)); },
      "Path getRoot()": function () { return this.p[0] === "/" ? mkPath("/") : null; },
      "Path resolve(String)": function (s) { var o = S(s); return mkPath(o[0] === "/" ? o : (this.p ? this.p.replace(/\/$/, "") + "/" : "") + o); },
      "Path resolve(Path)": function (o) { return mkPath(o.p[0] === "/" ? o.p : (this.p ? this.p.replace(/\/$/, "") + "/" : "") + o.p); },
      "Path resolveSibling(String)": function (s) { var par = jcall(this, "getParent", []); return par ? jcall(par, "resolve", [s]) : mkPath(S(s)); },
      "Path toAbsolutePath()": function () { return mkPath(norm(this.p) === "/" ? "/" : (this.p[0] === "/" ? this.p : HOME + "/" + this.p)); },
      "Path normalize()": function () { return mkPath(this.p[0] === "/" ? norm(this.p) : norm(this.p).replace(HOME + "/", "")); },
      "boolean isAbsolute()": function () { return this.p[0] === "/"; },
      "int getNameCount()": function () { return this.p.split("/").filter(Boolean).length; },
      "boolean startsWith(String)": function (s) { return this.p.indexOf(S(s)) === 0; },
      "boolean endsWith(String)": function (s) { return this.p.slice(-S(s).length) === S(s); },
      "java.io.File toFile()": function () { return { $c: L("java.io.File"), p: this.p }; },
      "Iterator<Path> iterator()": function () { return jcall(mkList(this.p.split("/").filter(Boolean).map(mkPath)), "iterator", []); },
      "int compareTo(Path)": function (o) { return I.compareStrings(this.p, o.p); },
      "String toString()": function () { return jstr(this.p); },
      "boolean equals(Object)": function (o) { return o !== null && o.$c === this.$c && o.p === this.p; },
      "int hashCode()": function () { return I.stringHash(this.p); }
    } });
    defLib("java.nio.file.Paths", { flags: "public final", noCtor: true, m: { "static Path get(String,String...)": function (a, rest) { return mkPath([S(a)].concat(Array.from(rest.a).map(S)).join("/")); } } });
    libEnum("java.nio.file.StandardOpenOption", ["READ", "WRITE", "APPEND", "TRUNCATE_EXISTING", "CREATE", "CREATE_NEW", "DELETE_ON_CLOSE", "SPARSE", "SYNC", "DSYNC"], {}, { impl: ["java.nio.file.OpenOption"] });
    defLib("java.nio.file.OpenOption", { kind: "interface", m: {} });
    libEnum("java.nio.file.StandardCopyOption", ["REPLACE_EXISTING", "COPY_ATTRIBUTES", "ATOMIC_MOVE"], {}, { impl: ["java.nio.file.CopyOption"] });
    defLib("java.nio.file.CopyOption", { kind: "interface", m: {} });
    defLib("java.nio.charset.Charset", { flags: "public abstract", noCtor: true, m: { "static Charset forName(String)": function (n) { return { $c: L("java.nio.charset.Charset"), n: S(n) }; }, "String toString()": function () { return jstr(this.n); } } });
    defLib("java.nio.charset.StandardCharsets", { flags: "public final", noCtor: true, m: { "static final java.nio.charset.Charset UTF_8": function () { return { $c: L("java.nio.charset.Charset"), n: "UTF-8" }; }, "static final java.nio.charset.Charset ISO_8859_1": function () { return { $c: L("java.nio.charset.Charset"), n: "ISO-8859-1" }; } } });
    var RS_FR = NSF_READ.concat(["java.base/java.nio.file.Files.readAllBytes(Files.java:2973)", "java.base/java.nio.file.Files.readString(Files.java:3043)", "java.base/java.nio.file.Files.readString(Files.java:3006)"]);
    var RL_FR = NSF_READ.concat(["java.base/java.nio.file.spi.FileSystemProvider.newInputStream(FileSystemProvider.java:380)", "java.base/java.nio.file.Files.newInputStream(Files.java:159)", "java.base/java.nio.file.Files.newBufferedReader(Files.java:2881)", "java.base/java.nio.file.Files.readAllLines(Files.java:3371)", "java.base/java.nio.file.Files.readAllLines(Files.java:3412)"]);
    defLib("java.nio.file.Files", { flags: "public final", noCtor: true, m: {
      "static String readString(Path) throws IOException": function (p) { return jstr(readFile(p, RS_FR)); },
      "static String readString(Path,java.nio.charset.Charset) throws IOException": function (p) { return jstr(readFile(p, RS_FR)); },
      "static List<String> readAllLines(Path) throws IOException": function (p) { return mkList(linesOf(readFile(p, RL_FR)).map(jstr)); },
      "static List<String> readAllLines(Path,java.nio.charset.Charset) throws IOException": function (p) { return mkList(linesOf(readFile(p, RL_FR)).map(jstr)); },
      "static java.util.stream.Stream<String> lines(Path) throws IOException": function (p) { return J.mkStream(linesOf(readFile(p)).map(jstr)); },
      "static Path writeString(Path,CharSequence,OpenOption...) throws IOException": function (p, s, o) { writeFile(p, toStr(s), hasOpt(o, "APPEND")); return p; },
      "static Path write(Path,Iterable<? extends CharSequence>,OpenOption...) throws IOException": function (p, ls, o) { writeFile(p, toArr(ls).map(toStr).map(function (x) { return x + "\n"; }).join(""), hasOpt(o, "APPEND")); return p; },
      "static Path write(Path,byte[],OpenOption...) throws IOException": function (p, b, o) { writeFile(p, decodeURIComponent(escape(String.fromCharCode.apply(null, Array.from(b.a).map(function (x) { return x & 255; })))), hasOpt(o, "APPEND")); return p; },
      "static byte[] readAllBytes(Path) throws IOException": function (p) { var t = unescape(encodeURIComponent(readFile(p))), a = newArray(T["byte"], t.length); for (var i = 0; i < t.length; i++) a.a[i] = (t.charCodeAt(i) << 24) >> 24; return a; },
      "static boolean exists(Path,java.nio.file.LinkOption...)": function (p) { return !!fs()[norm(pathStr(p))]; },
      "static boolean notExists(Path,java.nio.file.LinkOption...)": function (p) { return !fs()[norm(pathStr(p))]; },
      "static boolean isDirectory(Path,java.nio.file.LinkOption...)": function (p) { var n = fs()[norm(pathStr(p))]; return !!n && n.t === "d"; },
      "static boolean isRegularFile(Path,java.nio.file.LinkOption...)": function (p) { var n = fs()[norm(pathStr(p))]; return !!n && n.t === "f"; },
      "static boolean isReadable(Path)": function (p) { return !!fs()[norm(pathStr(p))]; },
      "static long size(Path) throws IOException": function (p) { return BigInt(utf8len(readFile(p))); },
      "static Path createFile(Path,java.nio.file.attribute.FileAttribute<?>...) throws IOException": function (p) { var a = norm(pathStr(p)); if (fs()[a]) throwJ("java.nio.file.FileAlreadyExistsException", jstr(pathStr(p))); writeFile(p, ""); return p; },
      "static Path createDirectory(Path,java.nio.file.attribute.FileAttribute<?>...) throws IOException": function (p) { var a = norm(pathStr(p)), f = fs(); if (f[a]) throwJ("java.nio.file.FileAlreadyExistsException", jstr(pathStr(p))); if (!f[parent(a)]) throwJ("java.nio.file.NoSuchFileException", jstr(pathStr(p))); f[a] = { t: "d" }; return p; },
      "static Path createDirectories(Path,java.nio.file.attribute.FileAttribute<?>...) throws IOException": function (p) { var a = norm(pathStr(p)), f = fs(), parts = a.split("/").filter(Boolean), cur = ""; parts.forEach(function (x) { cur += "/" + x; if (!f[cur]) f[cur] = { t: "d" }; }); return p; },
      "static void delete(Path) throws IOException": function (p) { var a = norm(pathStr(p)), f = fs(); if (!f[a]) throwJ("java.nio.file.NoSuchFileException", jstr(pathStr(p))); if (f[a].t === "d" && Object.keys(f).some(function (k) { return k.indexOf(a + "/") === 0; })) throwJ("java.nio.file.DirectoryNotEmptyException", jstr(pathStr(p))); delete f[a]; },
      "static boolean deleteIfExists(Path) throws IOException": function (p) { var a = norm(pathStr(p)), f = fs(); if (!f[a]) return false; delete f[a]; return true; },
      "static Path copy(Path,Path,java.nio.file.CopyOption...) throws IOException": function (a, b, o) { var t = readFile(a); if (fs()[norm(pathStr(b))] && !hasOpt(o, "REPLACE_EXISTING")) throwJ("java.nio.file.FileAlreadyExistsException", jstr(pathStr(b))); writeFile(b, t); return b; },
      "static Path move(Path,Path,java.nio.file.CopyOption...) throws IOException": function (a, b, o) { var t = readFile(a); if (fs()[norm(pathStr(b))] && !hasOpt(o, "REPLACE_EXISTING")) throwJ("java.nio.file.FileAlreadyExistsException", jstr(pathStr(b))); writeFile(b, t); delete fs()[norm(pathStr(a))]; return b; },
      "static java.util.stream.Stream<Path> list(Path) throws IOException": function (p) { var a = norm(pathStr(p)), f = fs(), base = pathStr(p).replace(/\/$/, ""); if (!f[a]) throwJ("java.nio.file.NoSuchFileException", jstr(pathStr(p))); var r = Object.keys(f).filter(function (k) { return parent(k) === a && k !== a; }).sort().map(function (k) { return mkPath((base === "." ? "." : base) + "/" + k.slice(a.length + 1).replace(/^\//, "")); }); return J.mkStream(r); },
      "static java.io.BufferedReader newBufferedReader(Path) throws IOException": function (p) { return mkReader(readFile(p)); },
      "static java.io.BufferedWriter newBufferedWriter(Path,OpenOption...) throws IOException": function (p, o) { var w = mkWriter(p, hasOpt(o, "APPEND")); w.$c = L("java.io.BufferedWriter"); return w; }
    } });
    defLib("java.nio.file.LinkOption", { kind: "interface", m: {} });
    defLib("java.nio.file.attribute.FileAttribute", { kind: "interface", tp: "T", m: {} });
    // java.io
    function mkReader(text) { return { $c: L("java.io.BufferedReader"), inp: new I.Input(text, true) }; }
    function mkWriter(p, append) { var w = { $c: L("java.io.Writer"), path: p, buf: "", append: append, closed: false }; if (!append) writeFile(p, ""); return w; }
    function flushW(w) { if (w.buf) { writeFile(w.path, w.buf, true); w.buf = ""; } }
    defLib("java.lang.Readable", { kind: "interface", m: {} });
    defLib("java.io.Reader", { flags: "public abstract", impl: ["java.io.Closeable", "java.lang.Readable"], m: {
      "int read() throws IOException": function () { var inp = this.inp; if (inp.pos >= inp.buf.length) { if (inp.need() === false) return -1; } return inp.buf.charCodeAt(inp.pos++); },
      "void close() throws IOException": function () {}
    } });
    defLib("java.io.InputStreamReader", { ext: "java.io.Reader", m: {
      "<init>(InputStream)": function () { this.inp = RT().stdin; },
      "<init>(InputStream,java.nio.charset.Charset)": function () { this.inp = RT().stdin; }
    } });
    defLib("java.io.FileReader", { ext: "java.io.Reader", m: {
      "<init>(String) throws java.io.FileNotFoundException": function (p) { var a = norm(S(p)), n = fs()[a]; if (!n || n.t !== "f") throwJ("java.io.FileNotFoundException", S(p) + (n ? " (É um diretório)" : " (Arquivo ou diretório inexistente)"), ["java.base/java.io.FileInputStream.open0(Native Method)", "java.base/java.io.FileInputStream.open(FileInputStream.java:213)", "java.base/java.io.FileInputStream.<init>(FileInputStream.java:152)", "java.base/java.io.FileInputStream.<init>(FileInputStream.java:106)", "java.base/java.io.FileReader.<init>(FileReader.java:60)"]); this.inp = new I.Input(n.d, true); },
      "<init>(java.io.File) throws java.io.FileNotFoundException": function (f) { this.inp = new I.Input(J.readFileText(f), true); }
    } });
    defLib("java.io.BufferedReader", { ext: "java.io.Reader", m: {
      "<init>(java.io.Reader)": function (r) { this.inp = r.inp; },
      "String readLine() throws IOException": function () { var l = this.inp.readLine(); return l === null ? null : jstr(l); },
      "java.util.stream.Stream<String> lines()": function () { var r = [], l; while ((l = this.inp.readLine()) !== null) r.push(jstr(l)); return J.mkStream(r); },
      "boolean ready() throws IOException": function () { return this.inp.pos < this.inp.buf.length; }
    } });
    defLib("java.io.Writer", { flags: "public abstract", impl: ["java.io.Closeable", "java.lang.Appendable"], m: {
      "void write(String) throws IOException": function (s) { if (this.out) RT().write("out", S(s)); else this.buf += S(s); },
      "void write(int) throws IOException": function (c) { this.buf += String.fromCharCode(c); },
      "Writer append(CharSequence) throws IOException": function (s) { this.buf += toStr(s); return this; },
      "void flush() throws IOException": function () { if (this.path) flushW(this); },
      "void close() throws IOException": function () { if (this.path) flushW(this); this.closed = true; }
    } });
    defLib("java.lang.Appendable", { kind: "interface", m: {} });
    defLib("java.io.FileWriter", { ext: "java.io.Writer", m: {
      "<init>(String) throws IOException": function (p) { var w = mkWriter(S(p), false); for (var k in w) if (k !== "$c") this[k] = w[k]; },
      "<init>(String,boolean) throws IOException": function (p, ap) { var w = mkWriter(S(p), ap); for (var k in w) if (k !== "$c") this[k] = w[k]; },
      "<init>(java.io.File) throws IOException": function (f) { var w = mkWriter(f.p, false); for (var k in w) if (k !== "$c") this[k] = w[k]; }
    } });
    defLib("java.io.BufferedWriter", { ext: "java.io.Writer", m: {
      "<init>(java.io.Writer)": function (w) { for (var k in w) if (k !== "$c") this[k] = w[k]; this.inner = w; },
      "void newLine() throws IOException": function () { this.buf += "\n"; }
    } });
    var PW = {
      "<init>(String) throws java.io.FileNotFoundException": function (p) { var w = mkWriter(S(p), false); for (var k in w) if (k !== "$c") this[k] = w[k]; },
      "<init>(java.io.Writer)": function (w) { for (var k in w) if (k !== "$c") this[k] = w[k]; },
      "<init>(java.io.OutputStream)": function () { this.out = true; this.buf = ""; },
      "<init>(java.io.OutputStream,boolean)": function () { this.out = true; this.buf = ""; },
      "PrintWriter printf(String,Object...)": function (f, a) { var t = I.jformat(f, a.a); if (this.out) RT().write("out", t); else this.buf += t; return this; },
      "void println()": function () { if (this.out) RT().write("out", "\n"); else this.buf += "\n"; },
      "void flush()": function () { if (this.path) flushW(this); },
      "void close()": function () { if (this.path) flushW(this); }
    };
    ["String", "Object", "int", "double", "char", "long", "boolean"].forEach(function (t) {
      var f = t === "char" ? function (v) { return String.fromCharCode(v); } : t === "double" ? I.doubleToString : t === "long" ? function (v) { return v.toString(); } : t === "Object" || t === "String" ? toStr : String;
      PW["void print(" + t + ")"] = function (v) { if (this.out) RT().write("out", f(v)); else this.buf += f(v); };
      PW["void println(" + t + ")"] = function (v) { if (this.out) RT().write("out", f(v) + "\n"); else this.buf += f(v) + "\n"; };
    });
    defLib("java.io.PrintWriter", { ext: "java.io.Writer", m: PW });
    defLib("java.io.File", { impl: ["Comparable<java.io.File>"], m: {
      "<init>(String)": function (p) { this.p = S(p); },
      "<init>(String,String)": function (a, b) { this.p = S(a) + "/" + S(b); },
      "<init>(java.io.File,String)": function (a, b) { this.p = a.p + "/" + S(b); },
      "boolean exists()": function () { return !!fs()[norm(this.p)]; },
      "boolean isFile()": function () { var n = fs()[norm(this.p)]; return !!n && n.t === "f"; },
      "boolean isDirectory()": function () { var n = fs()[norm(this.p)]; return !!n && n.t === "d"; },
      "String getName()": function () { return jstr(this.p.slice(this.p.lastIndexOf("/") + 1)); },
      "String getPath()": function () { return jstr(this.p); },
      "String getAbsolutePath()": function () { return jstr(norm(this.p)); },
      "String getParent()": function () { var i = this.p.lastIndexOf("/"); return i < 0 ? null : jstr(this.p.slice(0, i)); },
      "long length()": function () { var n = fs()[norm(this.p)]; return BigInt(n && n.t === "f" ? utf8len(n.d) : 0); },
      "boolean delete()": function () { var a = norm(this.p); if (!fs()[a]) return false; delete fs()[a]; return true; },
      "boolean createNewFile() throws IOException": function () { var a = norm(this.p); if (fs()[a]) return false; writeFile(this.p, ""); return true; },
      "boolean mkdir()": function () { var a = norm(this.p), f = fs(); if (f[a] || !f[parent(a)]) return false; f[a] = { t: "d" }; return true; },
      "boolean mkdirs()": function () { var a = norm(this.p), f = fs(), cur = ""; if (f[a]) return false; a.split("/").filter(Boolean).forEach(function (x) { cur += "/" + x; if (!f[cur]) f[cur] = { t: "d" }; }); return true; },
      "String[] list()": function () { var a = norm(this.p), f = fs(); return I.strArray(Object.keys(f).filter(function (k) { return parent(k) === a && k !== a; }).sort().map(function (k) { return k.slice(a.length + 1); })); },
      "java.nio.file.Path toPath()": function () { return mkPath(this.p); },
      "int compareTo(java.io.File)": function (o) { return I.compareStrings(this.p, o.p); },
      "String toString()": function () { return jstr(this.p); }
    } });

    // ---------- concorrência (determinística, numa thread só) ----------
    function mkFuture(run) {
      var f = { $c: L("java.util.concurrent.FutureImpl"), done: true };
      try { f.val = run(); } catch (e) { if (I.isInternal(e)) throw e; var ex = I.toJava(e); if (!ex) throw e; f.exc = ex; }
      return f;
    }
    function runInThread(name, fn) {
      var rt = RT(), prev = rt.curThread;
      rt.curThread = { $c: L("java.lang.Thread"), name: name, virt: name === "" };
      try { return fn(); } finally { rt.curThread = prev; }
    }
    defLib("java.util.concurrent.Future", { kind: "interface", tp: "V", m: {
      "V get() throws InterruptedException,java.util.concurrent.ExecutionException": null,
      "V get(long,java.util.concurrent.TimeUnit) throws InterruptedException,java.util.concurrent.ExecutionException,java.util.concurrent.TimeoutException": null,
      "boolean isDone()": null, "boolean cancel(boolean)": null, "boolean isCancelled()": null, "V resultNow()": null
    } });
    function futGet(f) {
      if (f.exc) { var w = I.mkThrowable("java.util.concurrent.ExecutionException", jstr(toStr(f.exc))); w.cause = f.exc; throw new I.JavaThrow(w); }
      return f.val === undefined ? null : f.val;
    }
    defLib("java.util.concurrent.FutureImpl", { tp: "V", impl: ["Future<V>"], bin: "java.util.concurrent.FutureTask", m: {
      "V get()": function () { return futGet(this); },
      "V get(long,java.util.concurrent.TimeUnit)": function () { return futGet(this); },
      "V resultNow()": function () { return futGet(this); },
      "boolean isDone()": function () { return true; }, "boolean cancel(boolean)": function () { return false; }, "boolean isCancelled()": function () { return false; },
      "String toString()": function () { return jstr("java.util.concurrent.FutureTask@" + I.identityHash(this).toString(16) + "[Completed normally]"); }
    } });
    defLib("java.util.concurrent.Executor", { kind: "interface", m: { "void execute(Runnable)": null } });
    defLib("java.util.concurrent.ExecutorService", { kind: "interface", impl: ["Executor", "AutoCloseable"], m: {
      "<T> Future<T> submit(java.util.concurrent.Callable<T>)": null, "Future<?> submit(Runnable)": null,
      "void shutdown()": null, "List<Runnable> shutdownNow()": null, "boolean isShutdown()": null, "boolean isTerminated()": null,
      "boolean awaitTermination(long,java.util.concurrent.TimeUnit) throws InterruptedException": null,
      "<T> List<Future<T>> invokeAll(Collection<? extends java.util.concurrent.Callable<T>>) throws InterruptedException": null,
      "<T> T invokeAny(Collection<? extends java.util.concurrent.Callable<T>>) throws InterruptedException,java.util.concurrent.ExecutionException": null,
      "void close()": null
    } });
    var poolSeq = 0;
    function mkPool(n, virt) { var rt = RT(); if (!virt) rt.poolSeq = (rt.poolSeq || 0) + 1; return { $c: L("java.util.concurrent.ExecutorImpl"), n: n || 1, virt: !!virt, id: rt.poolSeq, k: 0, shut: false }; }
    function poolThreadName(p) { if (p.virt) return ""; var i = (p.k++ % p.n) + 1; return "pool-" + p.id + "-thread-" + i; }
    function runTask(p, fn) {
      if (p.shut) throwJ("java.util.concurrent.RejectedExecutionException", "Task rejected");
      var nm = poolThreadName(p);
      return mkFuture(function () { return runInThread(nm, fn); });
    }
    I.defExc("java.util.concurrent.RejectedExecutionException", "RuntimeException");
    I.defExc("java.util.concurrent.CompletionException", "RuntimeException");
    I.defExc("java.util.concurrent.CancellationException", "IllegalStateException");
    defLib("java.util.concurrent.ExecutorImpl", { impl: ["java.util.concurrent.ExecutorService", "java.util.concurrent.ScheduledExecutorService"], bin: "java.util.concurrent.ThreadPoolExecutor", m: {
      "<T> Future<T> submit(java.util.concurrent.Callable<T>)": function (c) { return runTask(this, function () { return call(c, "call", []); }); },
      "Future<?> submit(Runnable)": function (r) { var f = runTask(this, function () { call(r, "run", []); return null; }); if (f.exc && false) {} return f; },
      "void execute(Runnable)": function (r) { var self = this; var nm = poolThreadName(this); runInThread(nm, function () { try { call(r, "run", []); } catch (e) { if (I.isInternal(e)) throw e; var ex = I.toJava(e); if (!ex) throw e; RT().write("err", "Exception in thread \"" + nm + "\" " + I.stackTraceText(ex)); } }); },
      "void shutdown()": function () { this.shut = true; },
      "List<Runnable> shutdownNow()": function () { this.shut = true; return mkList([]); },
      "boolean isShutdown()": function () { return this.shut; }, "boolean isTerminated()": function () { return this.shut; },
      "boolean awaitTermination(long,java.util.concurrent.TimeUnit)": function () { return true; },
      "<T> List<Future<T>> invokeAll(Collection<? extends java.util.concurrent.Callable<T>>)": function (cs) { var self = this; return mkList(toArr(cs).map(function (c) { return runTask(self, function () { return call(c, "call", []); }); })); },
      "<T> T invokeAny(Collection<? extends java.util.concurrent.Callable<T>>)": function (cs) { var self = this; var a = toArr(cs); return futGet(runTask(self, function () { return call(a[0], "call", []); })); },
      "void close()": function () { this.shut = true; },
      "java.util.concurrent.ScheduledFuture<?> schedule(Runnable,long,java.util.concurrent.TimeUnit)": function (r, d, u) { RT().clockAdvance(Number(d) * unitMs(u)); return runTask(this, function () { call(r, "run", []); return null; }); }
    } });
    defLib("java.util.concurrent.ScheduledExecutorService", { kind: "interface", impl: ["java.util.concurrent.ExecutorService"], m: { "java.util.concurrent.ScheduledFuture<?> schedule(Runnable,long,java.util.concurrent.TimeUnit)": null } });
    defLib("java.util.concurrent.ScheduledFuture", { kind: "interface", tp: "V", impl: ["java.util.concurrent.Future<V>"], m: {} });
    defLib("java.util.concurrent.Executors", { flags: "public final", noCtor: true, m: {
      "static ExecutorService newFixedThreadPool(int)": function (n) { return mkPool(n); },
      "static ExecutorService newSingleThreadExecutor()": function () { return mkPool(1); },
      "static ExecutorService newCachedThreadPool()": function () { return mkPool(1000); },
      "static ExecutorService newWorkStealingPool()": function () { return mkPool(4); },
      "static ExecutorService newVirtualThreadPerTaskExecutor()": function () { return mkPool(1, true); },
      "static ScheduledExecutorService newScheduledThreadPool(int)": function (n) { return mkPool(n); },
      "static ExecutorService newThreadPerTaskExecutor(java.util.concurrent.ThreadFactory)": function () { return mkPool(1000); }
    } });
    defLib("java.util.concurrent.ThreadFactory", { kind: "interface", m: { "Thread newThread(Runnable)": null } });
    function unitMs(u) { return { NANOSECONDS: 1e-6, MICROSECONDS: 1e-3, MILLISECONDS: 1, SECONDS: 1000, MINUTES: 60000, HOURS: 3600000, DAYS: 86400000 }[u.$name] || 1; }
    libEnum("java.util.concurrent.TimeUnit", ["NANOSECONDS", "MICROSECONDS", "MILLISECONDS", "SECONDS", "MINUTES", "HOURS", "DAYS"], {
      "void sleep(long) throws InterruptedException": function (n) { RT().clockAdvance(Number(n) * unitMs(this)); },
      "long toMillis(long)": function (n) { return BigInt(Math.floor(Number(n) * unitMs(this))); },
      "long toSeconds(long)": function (n) { return BigInt(Math.floor(Number(n) * unitMs(this) / 1000)); }
    });
    // CompletableFuture
    var CF_POOL = "ForkJoinPool.commonPool-worker-1";
    function cf(val, exc) { return { $c: L("java.util.concurrent.CompletableFuture"), val: val, exc: exc || null }; }
    function cfRun(fn, name) { try { return cf(runInThread(name || CF_POOL, fn)); } catch (e) { if (I.isInternal(e)) throw e; var ex = I.toJava(e); if (!ex) throw e; var w = ex.$c.full === "java.util.concurrent.CompletionException" ? ex : (function () { var c = I.mkThrowable("java.util.concurrent.CompletionException", jstr(toStr(ex))); c.cause = ex; return c; })(); return cf(null, w); } }
    function cfThen(self, fn) { if (self.exc) return cf(null, self.exc); return cfRun(function () { return fn(self.val); }, RT().curThread ? RT().curThread.name : "main"); }
    defLib("java.util.concurrent.CompletionStage", { kind: "interface", tp: "T", m: {} });
    defLib("java.util.concurrent.CompletableFuture", { tp: "T", impl: ["Future<T>", "java.util.concurrent.CompletionStage<T>"], m: {
      "<init>()": function () { this.val = null; this.exc = null; this.pending = true; },
      "static <U> CompletableFuture<U> supplyAsync(java.util.function.Supplier<U>)": function (s) { return cfRun(function () { return call(s, "get", []); }); },
      "static <U> CompletableFuture<U> supplyAsync(java.util.function.Supplier<U>,Executor)": function (s, ex) { var nm = ex && ex.n ? poolThreadName(ex) : CF_POOL; return cfRun(function () { return call(s, "get", []); }, nm); },
      "static CompletableFuture<Void> runAsync(Runnable)": function (r) { return cfRun(function () { call(r, "run", []); return null; }); },
      "static CompletableFuture<Void> runAsync(Runnable,Executor)": function (r, ex) { var nm = ex && ex.n ? poolThreadName(ex) : CF_POOL; return cfRun(function () { call(r, "run", []); return null; }, nm); },
      "static <U> CompletableFuture<U> completedFuture(U)": function (v) { return cf(v); },
      "static CompletableFuture<Void> allOf(CompletableFuture<?>...)": function (a) { var bad = Array.from(a.a).filter(function (x) { return x.exc; })[0]; return cf(null, bad ? bad.exc : null); },
      "static CompletableFuture<Object> anyOf(CompletableFuture<?>...)": function (a) { var f = a.a[0]; return cf(f ? f.val : null, f ? f.exc : null); },
      "<U> CompletableFuture<U> thenApply(java.util.function.Function<? super T,? extends U>)": function (f) { return cfThen(this, function (v) { return call(f, "apply", [v]); }); },
      "<U> CompletableFuture<U> thenApplyAsync(java.util.function.Function<? super T,? extends U>)": function (f) { var self = this; if (self.exc) return cf(null, self.exc); return cfRun(function () { return call(f, "apply", [self.val]); }); },
      "CompletableFuture<Void> thenAccept(java.util.function.Consumer<? super T>)": function (c) { return cfThen(this, function (v) { call(c, "accept", [v]); return null; }); },
      "CompletableFuture<Void> thenRun(Runnable)": function (r) { return cfThen(this, function () { call(r, "run", []); return null; }); },
      "<U,V> CompletableFuture<V> thenCombine(java.util.concurrent.CompletionStage<? extends U>,java.util.function.BiFunction<? super T,? super U,? extends V>)": function (o, f) { var self = this; if (self.exc) return cf(null, self.exc); if (o.exc) return cf(null, o.exc); return cfRun(function () { return call(f, "apply", [self.val, o.val]); }, "main"); },
      "<U> CompletableFuture<U> thenCompose(java.util.function.Function<? super T,? extends java.util.concurrent.CompletionStage<U>>)": function (f) { if (this.exc) return cf(null, this.exc); var self = this; var r = cfRun(function () { return call(f, "apply", [self.val]); }, "main"); return r.exc ? r : r.val; },
      "CompletableFuture<T> exceptionally(java.util.function.Function<Throwable,? extends T>)": function (f) { if (!this.exc) return this; var ex = this.exc; return cfRun(function () { return call(f, "apply", [ex]); }, "main"); },
      "<U> CompletableFuture<U> handle(java.util.function.BiFunction<? super T,Throwable,? extends U>)": function (f) { var self = this; return cfRun(function () { return call(f, "apply", [self.exc ? null : self.val, self.exc]); }, "main"); },
      "CompletableFuture<T> whenComplete(java.util.function.BiConsumer<? super T,? super Throwable>)": function (f) { call(f, "accept", [this.exc ? null : this.val, this.exc]); return this; },
      "T join()": function () { if (this.exc) throw new I.JavaThrow(this.exc); return this.val; },
      "T get() throws InterruptedException,java.util.concurrent.ExecutionException": function () { if (this.exc) { var c = this.exc.cause || this.exc; var w = I.mkThrowable("java.util.concurrent.ExecutionException", jstr(toStr(c))); w.cause = c; throw new I.JavaThrow(w); } return this.val; },
      "T get(long,java.util.concurrent.TimeUnit)": function () { return jcall(this, "get", []); },
      "boolean complete(T)": function (v) { if (!this.pending) return false; this.val = v; this.pending = false; return true; },
      "boolean isDone()": function () { return !this.pending; },
      "T resultNow()": function () { return this.val; },
      "String toString()": function () { return jstr("java.util.concurrent.CompletableFuture@" + I.identityHash(this).toString(16) + (this.exc ? "[Completed exceptionally: " + toStr(this.exc) + "]" : "[Completed normally]")); }
    } });
    function atomic(name, prim) {
      var isL = prim === "long";
      function v(x) { return isL ? BigInt.asIntN(64, x) : x | 0; }
      var one = isL ? 1n : 1, zero = isL ? 0n : 0;
      var m = { "<init>()": function () { this.v = zero; } };
      m["<init>(" + prim + ")"] = function (x) { this.v = x; };
      m[prim + " get()"] = function () { return this.v; };
      m["void set(" + prim + ")"] = function (x) { this.v = x; };
      m[prim + " incrementAndGet()"] = function () { return this.v = v(this.v + one); };
      m[prim + " decrementAndGet()"] = function () { return this.v = v(this.v - one); };
      m[prim + " getAndIncrement()"] = function () { var o = this.v; this.v = v(this.v + one); return o; };
      m[prim + " getAndDecrement()"] = function () { var o = this.v; this.v = v(this.v - one); return o; };
      m[prim + " addAndGet(" + prim + ")"] = function (d) { return this.v = v(this.v + d); };
      m[prim + " getAndAdd(" + prim + ")"] = function (d) { var o = this.v; this.v = v(this.v + d); return o; };
      m[prim + " getAndSet(" + prim + ")"] = function (d) { var o = this.v; this.v = d; return o; };
      m["boolean compareAndSet(" + prim + "," + prim + ")"] = function (a, b) { if (this.v === a) { this.v = b; return true; } return false; };
      var FN = isL ? "LongUnaryOperator" : "IntUnaryOperator", BF = isL ? "LongBinaryOperator" : "IntBinaryOperator", AP = isL ? "applyAsLong" : "applyAsInt";
      m[prim + " updateAndGet(java.util.function." + FN + ")"] = function (f) { return this.v = call(f, AP, [this.v]); };
      m[prim + " getAndUpdate(java.util.function." + FN + ")"] = function (f) { var o = this.v; this.v = call(f, AP, [this.v]); return o; };
      m[prim + " accumulateAndGet(" + prim + ",java.util.function." + BF + ")"] = function (x, f) { return this.v = call(f, AP, [this.v, x]); };
      m["int intValue()"] = function () { return Number(this.v); };
      m["long longValue()"] = function () { return BigInt(this.v); };
      m["double doubleValue()"] = function () { return Number(this.v); };
      m["float floatValue()"] = function () { return Number(this.v); };
      m["String toString()"] = function () { return jstr(String(this.v)); };
      defLib("java.util.concurrent.atomic." + name, { ext: "Number", m: m });
    }
    atomic("AtomicInteger", "int");
    atomic("AtomicLong", "long");
    defLib("java.util.concurrent.atomic.AtomicBoolean", { m: {
      "<init>()": function () { this.v = false; }, "<init>(boolean)": function (b) { this.v = b; },
      "boolean get()": function () { return this.v; }, "void set(boolean)": function (b) { this.v = b; },
      "boolean compareAndSet(boolean,boolean)": function (a, b) { if (this.v === a) { this.v = b; return true; } return false; },
      "boolean getAndSet(boolean)": function (b) { var o = this.v; this.v = b; return o; },
      "String toString()": function () { return jstr(String(this.v)); }
    } });
    defLib("java.util.concurrent.atomic.AtomicReference", { tp: "V", m: {
      "<init>()": function () { this.v = null; }, "<init>(V)": function (x) { this.v = x; },
      "V get()": function () { return this.v; }, "void set(V)": function (x) { this.v = x; },
      "V getAndSet(V)": function (x) { var o = this.v; this.v = x; return o; },
      "boolean compareAndSet(V,V)": function (a, b) { if (this.v === a) { this.v = b; return true; } return false; },
      "V updateAndGet(java.util.function.UnaryOperator<V>)": function (f) { return this.v = call(f, "apply", [this.v]); },
      "String toString()": function () { return jstr(toStr(this.v)); }
    } });
    // ConcurrentHashMap e CopyOnWriteArrayList: mesmas estruturas, outro nome
    (function () {
      var HMs = L("java.util.HashMap").lib.spec.m, m = {};
      Object.keys(HMs).forEach(function (k) { m[k] = HMs[k]; });
      defLib("java.util.concurrent.ConcurrentHashMap", { tp: "K,V", impl: ["java.util.concurrent.ConcurrentMap<K,V>", "java.io.Serializable"], m: m });
      defLib("java.util.concurrent.ConcurrentMap", { kind: "interface", tp: "K,V", impl: ["Map<K,V>"], m: {} });
      var AL = L("java.util.ArrayList").lib.spec.m, m2 = {};
      Object.keys(AL).forEach(function (k) { m2[k] = AL[k]; });
      defLib("java.util.concurrent.CopyOnWriteArrayList", { tp: "E", impl: ["List<E>", "java.util.RandomAccess"], m: m2 });
      L("java.util.concurrent.CopyOnWriteArrayList").toArr = function (o) { return o.a.slice(); };
      var DQ = L("java.util.ArrayDeque").lib.spec.m, m3 = {};
      Object.keys(DQ).forEach(function (k) { m3[k] = DQ[k]; });
      m3["void put(E) throws InterruptedException"] = DQ["boolean offer(E)"];
      m3["E take() throws InterruptedException"] = DQ["E poll()"];
      defLib("java.util.concurrent.LinkedBlockingQueue", { tp: "E", impl: ["java.util.concurrent.BlockingQueue<E>"], m: m3 });
      defLib("java.util.concurrent.ArrayBlockingQueue", { tp: "E", impl: ["java.util.concurrent.BlockingQueue<E>"], m: Object.assign({}, m3, { "<init>(int)": m3["<init>()"] }) });
      defLib("java.util.concurrent.BlockingQueue", { kind: "interface", tp: "E", impl: ["Queue<E>"], m: { "void put(E) throws InterruptedException": null, "E take() throws InterruptedException": null } });
      L("java.util.concurrent.LinkedBlockingQueue").toArr = function (o) { return o.a.slice(); };
    })();
    defLib("java.util.concurrent.CountDownLatch", { m: {
      "<init>(int)": function (n) { this.n = n; },
      "void countDown()": function () { if (this.n > 0) this.n--; },
      "long getCount()": function () { return BigInt(this.n); },
      "void await() throws InterruptedException": function () {},
      "boolean await(long,java.util.concurrent.TimeUnit) throws InterruptedException": function () { return this.n === 0; }
    } });
    defLib("java.util.concurrent.Semaphore", { m: {
      "<init>(int)": function (n) { this.n = n; },
      "void acquire() throws InterruptedException": function () { this.n--; }, "void release()": function () { this.n++; },
      "boolean tryAcquire()": function () { if (this.n > 0) { this.n--; return true; } return false; },
      "int availablePermits()": function () { return this.n; }
    } });
    defLib("java.util.concurrent.locks.Lock", { kind: "interface", m: { "void lock()": null, "void unlock()": null, "boolean tryLock()": null } });
    defLib("java.util.concurrent.locks.ReentrantLock", { impl: ["java.util.concurrent.locks.Lock"], m: {
      "<init>()": function () { this.c = 0; }, "<init>(boolean)": function () { this.c = 0; },
      "void lock()": function () { this.c++; },
      "void unlock()": function () { if (this.c <= 0) throwJ("java.lang.IllegalMonitorStateException", null); this.c--; },
      "boolean tryLock()": function () { this.c++; return true; },
      "boolean isLocked()": function () { return this.c > 0; }
    } });
    I.defExc("java.lang.IllegalMonitorStateException", "RuntimeException");
    defLib("java.util.concurrent.ThreadLocalRandom", { ext: "java.util.Random", noCtor: true, m: {
      "static ThreadLocalRandom current()": function () { var rt = RT(); if (!rt.tlr) { rt.tlr = { $c: L("java.util.concurrent.ThreadLocalRandom"), r: new I.JRandom(rt.nextSeed()) }; } return rt.tlr; }
    } });
  });
})(typeof window !== "undefined" ? window : globalThis);
if (typeof JavaSim !== "undefined" && JavaSim._libPronta) JavaSim._libPronta(); else if (typeof window !== "undefined" && window.JavaSim && window.JavaSim._libPronta) window.JavaSim._libPronta();
