@0xd89880a164e0e7da;

enum Mode { idle @0; ready @1; failed @2; }
struct Child { label @0 :Text; count @1 :UInt32; }
struct Payload {
  enabled @0 :Bool = true;
  signed @1 :Int64 = -17;
  unsigned @2 :UInt64 = 18446744073709551615;
  ratio @3 :Float64 = 1.5;
  mode @4 :Mode = ready;
  text @5 :Text = "default text";
  data @6 :Data;
  child @7 :Child;
  flags @8 :List(Bool);
  numbers @9 :List(Int32);
  names @10 :List(Text);
  children @11 :List(Child);
  matrix @12 :List(List(UInt16));
  union {
    none @13 :Void;
    selection @14 :Text;
  }
  details :group {
    note @15 :Text;
    amount @16 :UInt8;
  }
}
interface Workbench @0xb1529bf8e102de33 {
  echo @0 (value :Payload) -> (value :Payload);
  add @1 (a :Int64, b :Int64) -> (sum :Int64);
  fail @2 () -> ();
  wait @3 (milliseconds :UInt32) -> (done :Bool);
}
