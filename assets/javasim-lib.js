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
      "java.util.HashMap": ["java.base/java.util.HashMap$HashIterator.nextNode(HashMap.java:1605)", "java.base/java.util.HashMap$KeyIterator.next(HashMap.java:1628)"],
      "java.util.LinkedList": ["java.base/java.util.LinkedList$ListItr.checkForComodification(LinkedList.java:977)", "java.base/java.util.LinkedList$ListItr.next(LinkedList.java:899)"] };
    defLib("java.util.ArrayIteratorImpl", { impl: ["ListIterator<Object>"], bin: "java.util.ArrayList$Itr", m: {
      "boolean hasNext()": function () { return this.i < this.getArr().length; },
      "Object next()": function () {
        if (this.owner && this.owner.mod !== this.mod) throwJ("java.util.ConcurrentModificationException", null, this.frames || CME_FRAMES["java.util.ArrayList"]);
        var a = this.getArr();
        if (this.i >= a.length) throwJ("java.util.NoSuchElementException", null);
        this.last = this.i;
        return a[this.i++];
      },
      "boolean hasPrevious()": function () { return this.i > 0; },
      "Object previous()": function () { var a = this.getArr(); if (this.i <= 0) throwJ("java.util.NoSuchElementException", null); this.i--; this.last = this.i; return a[this.i]; },
      "int nextIndex()": function () { return this.i; },
      "int previousIndex()": function () { return this.i - 1; },
      "void remove()": function () {
        if (this.last < 0) throwJ("java.lang.IllegalStateException", null);
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
    var IMM = ["java.base/java.util.ImmutableCollections.uoe(ImmutableCollections.java:142)"];
    function immFail(meth) { throwJ("java.lang.UnsupportedOperationException", null, IMM.concat(["java.base/java.util.ImmutableCollections$AbstractImmutableCollection." + meth + "(ImmutableCollections.java:" + ({ add: 147, remove: 150, clear: 148, addAll: 148, removeIf: 151 }[meth] || 147) + ")"])); }
    function idxFail(i, n) { throwJ("java.lang.IndexOutOfBoundsException", "Index " + i + " out of bounds for length " + n, ["java.base/jdk.internal.util.Preconditions.outOfBounds(Preconditions.java:100)", "java.base/jdk.internal.util.Preconditions.outOfBoundsCheckIndex(Preconditions.java:106)", "java.base/jdk.internal.util.Preconditions.checkIndex(Preconditions.java:302)", "java.base/java.util.Objects.checkIndex(Objects.java:385)", "java.base/java.util.ArrayList.get(ArrayList.java:434)"]); }
    function mut(self, op) {
      if (self.imm) immFail(op);
      if (self.fixed && (op === "add" || op === "remove" || op === "clear" || op === "addAll" || op === "removeIf")) throwJ("java.lang.UnsupportedOperationException", null, ["java.base/java.util.AbstractList." + op + "(AbstractList.java:" + (op === "add" ? 155 : 169) + ")"]);
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
      "E get(int)": function (i) { if (i < 0 || i >= this.a.length) idxFail(i, this.a.length); return this.a[i]; },
      "E set(int,E)": function (i, v) { if (this.imm) immFail("set"); if (i < 0 || i >= this.a.length) idxFail(i, this.a.length); var o = this.a[i]; this.a[i] = v; return o; },
      "boolean add(E)": function (v) { mut(this, "add"); this.a.push(v); this.mod++; return true; },
      "void add(int,E)": function (i, v) { mut(this, "add"); if (i < 0 || i > this.a.length) throwJ("java.lang.IndexOutOfBoundsException", "Index: " + i + ", Size: " + this.a.length); this.a.splice(i, 0, v); this.mod++; },
      "E remove(int)": function (i) { mut(this, "remove"); if (i < 0 || i >= this.a.length) idxFail(i, this.a.length); this.mod++; return this.a.splice(i, 1)[0]; },
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
      "E getFirst()": function () { if (!this.a.length) throwJ("java.util.NoSuchElementException", null); return this.a[0]; },
      "E getLast()": function () { if (!this.a.length) throwJ("java.util.NoSuchElementException", null); return this.a[this.a.length - 1]; },
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
      "E pop()": function () { if (!this.a.length) throwJ("java.util.NoSuchElementException", null); this.mod++; return this.a.shift(); },
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
      st["E pop()"] = function () { if (!this.a.length) throwJ("java.util.EmptyStackException", null); this.mod++; return this.a.pop(); };
      st["E peek()"] = function () { if (!this.a.length) throwJ("java.util.EmptyStackException", null); return this.a[this.a.length - 1]; };
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
      "boolean add(E)": function (v) { if (v === null) npe(); this.a.push(v); pqUp(this, this.a.length - 1, v); this.mod++; return true; },
      "boolean offer(E)": function (v) { if (v === null) npe(); this.a.push(v); pqUp(this, this.a.length - 1, v); this.mod++; return true; },
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
      "boolean removeIf(java.util.function.Predicate<? super E>)": function (p) { var self = this, ch = false; viewArr(this).forEach(function (x) { if (test(p, x)) { jcall(self.m, "remove", [self.kind === "entries" ? x.e.key : x]); ch = true; } }); return ch; },
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
        var e = hmFind(this, k);
        if (e) { var n = e.value === null ? v : apply2(f, e.value, v); if (n === null) hmRemove(this, k); else { e.value = n; if (this.access) touch(this, e); } return n; }
        hmPut(this, k, v, false, true); return v;
      },
      "V computeIfAbsent(K,java.util.function.Function<? super K,? extends V>)": function (k, f) {
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
        if (hmFind(m, kv[i])) throwJ("java.lang.IllegalArgumentException", "duplicate key: " + toStr(kv[i]));
        hmPut(m, kv[i], kv[i + 1]);
      }
      return m;
    }
    var IMMM = {};
    Object.keys(HM).forEach(function (k) { IMMM[k] = HM[k]; });
    ["V put(K,V)", "V remove(Object)", "void clear()", "void putAll(Map<? extends K,? extends V>)", "V merge(K,V,java.util.function.BiFunction<? super V,? super V,? extends V>)", "V computeIfAbsent(K,java.util.function.Function<? super K,? extends V>)", "V putIfAbsent(K,V)", "V compute(K,java.util.function.BiFunction<? super K,? super V,? extends V>)"].forEach(function (k) {
      IMMM[k] = function () { throwJ("java.lang.UnsupportedOperationException", null, IMM.concat(["java.base/java.util.ImmutableCollections$AbstractImmutableMap." + k.replace(/^\S+ (\w+)\(.*$/, "$1") + "(ImmutableCollections.java:" + 1095 + ")"])); };
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
    function tmPut(m, k, v) {
      if (!m.tm.length) cmp(m.cmp, k, k);
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
      "K firstKey()": function () { if (!this.tm.length) throwJ("java.util.NoSuchElementException", null); return this.tm[0].key; },
      "K lastKey()": function () { if (!this.tm.length) throwJ("java.util.NoSuchElementException", null); return this.tm[this.tm.length - 1].key; },
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
      "boolean add(E)": function (x) { var had = this.t.tm.length && tmFind(this.t, x).found; if (had) return false; tmPut(this.t, x, true); this.mod++; return true; },
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
    function pull(s) {
      if (s.used) throwJ("java.lang.IllegalStateException", "stream has already been operated upon or closed");
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
      "long count()": function () { return BigInt(drain(this).length); },
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
    function mkHashMap() { var m = { $c: L("java.util.HashMap") }; jcall(m, "<init>", []); return m; }
    function newMap(supplier) { if (supplier) return call(supplier, "get", []); var m = { $c: L("java.util.HashMap") }; L("java.util.HashMap").ctors[0].impl.call(m); return m; }
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
          if (jcall(m, "containsKey", [k])) throwJ("java.lang.IllegalStateException", "Duplicate key " + toStr(k) + " (attempted merging values " + toStr(jcall(m, "get", [k])) + " and " + toStr(v) + ")");
          jcall(m, "put", [k, v]);
        });
      },
      "static <T,K,U> Collector<T,?,Map<K,U>> toMap(java.util.function.Function<? super T,? extends K>,java.util.function.Function<? super T,? extends U>,java.util.function.BinaryOperator<U>)": function (kf, vf, mg) { return mkCol(function () { return newMap(null); }, function (m, x) { jcall(m, "merge", [apply(kf, x), apply(vf, x), mg]); }); },
      "static <T,K,U,M extends Map<K,U>> Collector<T,?,M> toMap(java.util.function.Function<? super T,? extends K>,java.util.function.Function<? super T,? extends U>,java.util.function.BinaryOperator<U>,java.util.function.Supplier<M>)": function (kf, vf, mg, s) { return mkCol(function () { return call(s, "get", []); }, function (m, x) { jcall(m, "merge", [apply(kf, x), apply(vf, x), mg]); }); },
      "static <T,R1,R2,R> Collector<T,?,R> teeing(Collector<? super T,?,R1>,Collector<? super T,?,R2>,java.util.function.BiFunction<? super R1,? super R2,R>)": function (c1, c2, f) { return mkCol(function () { return [c1.col.sup(), c2.col.sup()]; }, function (a, x) { c1.col.acc(a[0], x); c2.col.acc(a[1], x); }, function (a) { return call(f, "apply", [c1.col.fin ? c1.col.fin(a[0]) : a[0], c2.col.fin ? c2.col.fin(a[1]) : a[1]]); }); }
    } });
    function partCol(p, d) {
      return mkCol(function () { return { f: d ? d.col.sup() : [], t: d ? d.col.sup() : [] }; }, function (a, x) { var k = test(p, x) ? "t" : "f"; if (d) d.col.acc(a[k], x); else a[k].push(x); }, function (a) {
        var m = { $c: L("java.util.LinkedHashMap") };
        L("java.util.LinkedHashMap").ctors[0].impl.call(m);
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
      "static <T extends Object & Comparable<? super T>> T max(Collection<? extends T>)": function (c) { var a = toArr(c); if (!a.length) throwJ("java.util.NoSuchElementException", null); var b = a[0]; a.forEach(function (x) { if (jcompare(x, b) > 0) b = x; }); return b; },
      "static <T extends Object & Comparable<? super T>> T min(Collection<? extends T>)": function (c) { var a = toArr(c); if (!a.length) throwJ("java.util.NoSuchElementException", null); var b = a[0]; a.forEach(function (x) { if (jcompare(x, b) < 0) b = x; }); return b; },
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
if (typeof JavaSim !== "undefined" && JavaSim._libPronta) JavaSim._libPronta(); else if (typeof window !== "undefined" && window.JavaSim && window.JavaSim._libPronta) window.JavaSim._libPronta();
